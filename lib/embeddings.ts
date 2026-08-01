import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { vaultKey } from "@/lib/journal";

/**
 * Local semantic search.
 *
 * This is not here to understand the wiki. A frontier model reading the pages
 * understands them far better than a 23MB MiniLM ever will, and pretending
 * otherwise would be dishonest. It is here for two things a hosted model can't
 * give the UI: instant, and offline.
 *
 * Instant, because related-pages and similarity have to answer while you type,
 * and a network round trip per keystroke does not. Offline, because this corpus
 * contains client names and financials, and shipping it to an embedding API to
 * get a "related pages" list is a bad trade.
 *
 * The measured failure it fixes: the query "how do I undo a deploy" returns
 * zero literal results against a page whose text is "Rollback is a revert
 * commit". No amount of substring matching bridges that; a vector does.
 *
 * Everything degrades to nothing rather than to an error. If the model isn't
 * installed, isn't downloaded yet, or fails to load, search returns [] and the
 * caller falls back to literal matching.
 */

const MODEL = "Xenova/all-MiniLM-L6-v2";
const STORE_VERSION = 1;

const DIR = path.join(os.homedir(), ".lore");
const indexPath = (key: string) => path.join(DIR, `embeddings-${key}.json`);
/** Model weights are cached under ~/.lore too, so nothing lands in the vault. */
const MODEL_CACHE = path.join(DIR, "models");

/**
 * MiniLM truncates at 256 word-pieces. A 400-word chunk would therefore have
 * its tail silently dropped before it was ever embedded — the chunk would look
 * indexed and simply not contain half its content. 180 words of markdown prose
 * lands under that ceiling with room for the title prefix.
 */
const CHUNK_WORDS = 180;
const CHUNK_OVERLAP = 40;
/** A single 20,000-word page shouldn't cost more index time than 30 real ones. */
const MAX_CHUNKS_PER_PAGE = 24;
const BATCH = 16;

/**
 * Cosine floor. Below this the ranking is noise, and returning the whole vault
 * sorted by noise is worse than returning nothing — the user reads the top hit
 * as an answer either way.
 */
/**
 * Relevance floor, chosen from measurement rather than taste.
 *
 * all-MiniLM-L6-v2 is a SYMMETRIC similarity model — trained on sentence pairs,
 * not asymmetric query-to-document retrieval — so its absolute scores are not
 * calibrated. Scored against a real vault:
 *
 *   TRUE  "how do I undo a deploy"    0.454      FALSE "banana pancakes"        0.140
 *   TRUE  "when do we ship"           0.413      FALSE "my cat is asleep"       0.095
 *   TRUE  "reverting a release"       0.368      FALSE "photosynthesis in ferns" 0.043
 *   TRUE  "what database are we on"   0.154 <-- and it ranked the WRONG page first
 *
 * 0.30 separates every query the model actually gets right from every one it
 * does not. The fourth case sits below the floor, and that is the correct
 * outcome, not a tuning failure: the model genuinely cannot answer it, ranking
 * an unrelated page above the right one. Returning nothing is a better answer
 * than returning a confident wrong one — this is a wiki people will trust.
 *
 * An earlier attempt used a low floor plus a purely relative cutoff. It matched
 * "banana pancakes" to a page about weekly scheduling, because a relative gate
 * always returns something. That is strictly worse than silence.
 *
 * CALIBRATION CAVEAT: these numbers come from a nine-page fixture. Nine pages is
 * enough to show that nonsense is rejected and obvious matches are not, and not
 * nearly enough to tune a boundary — on a small corpus a stub page can outrank
 * the right one on noise alone. Re-measure against a few hundred real pages
 * before moving this number, and prefer leaving it slightly strict: a miss sends
 * the user to literal search, a false positive sends them to the wrong answer.
 */
const MIN_SCORE = 0.3;

/**
 * Having cleared the floor, drop anything far below the best hit for this
 * query. Prevents one strong match from dragging a tail of weak ones with it.
 */
const RELATIVE_CUTOFF = 0.55;
const MIN_RELATED = 0.3;

/** Don't re-attempt a failed 23MB download on every keystroke. */
const RETRY_MS = 60_000;

export type EmbeddingStatus = {
  ready: boolean;
  /**
   * Null until the pipeline has actually loaded, which on the first run means
   * a ~23MB download. `building && model === null` is the case worth rendering
   * as "downloading model" rather than letting the UI look hung.
   *
   * Null does not imply a download is in flight: a warm index loaded from disk
   * reports `ready` with no model until the first query pulls the pipeline in.
   * `model === null && error === null` only means "not loaded yet".
   */
  model: string | null;
  indexed: number;
  total: number;
  building: boolean;
  error: string | null;
};

// -------------------------------------------------------------- optional dep

/**
 * transformers.js is loaded through a runtime `import` the bundler cannot
 * statically see. It is an optional dependency: if it isn't installed, Lore
 * must still build and every other feature must still work, with semantic
 * search reporting an honest error instead of taking the app down.
 */
const importRuntime = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

type Extractor = (
  input: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

type Transformers = {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options: { quantized: boolean },
  ) => Promise<Extractor>;
  env: { cacheDir: string };
};

// -------------------------------------------------------------------- state

type PageVectors = { hash: string; vectors: Float32Array[] };

type StoredIndex = {
  version: number;
  model: string;
  pages: Record<string, { hash: string; vectors: string[] }>;
};

type State = { root: string; key: string; pages: Map<string, PageVectors> };

let state: State | null = null;
let loading: { root: string; promise: Promise<State> } | null = null;
let extractor: Extractor | null = null;
let extractorLoad: Promise<Extractor | null> | null = null;
let lastFailureAt = 0;
let building: Promise<void> | null = null;
/**
 * The newest page set handed to `ensureIndex` while a build was already
 * draining. A running build works from a fixed list and cannot see it.
 */
let queued: SourcePage[] | null = null;

const status: EmbeddingStatus = {
  ready: false,
  model: null,
  indexed: 0,
  total: 0,
  building: false,
  error: null,
};

export function embeddingStatus(): EmbeddingStatus {
  return { ...status };
}

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

// --------------------------------------------------------------- persistence

/**
 * Vectors are stored as base64 float32 rather than JSON numbers. A 384-dim
 * vector is 1,536 bytes packed, so 2,048 characters of base64 on disk, against
 * roughly 3KB as rounded decimal text — and a 1,400-page vault runs to several
 * thousand chunks. Base64 is the smaller of the two and, unlike rounding to
 * four places, gives back exactly the float that was written.
 */
const encodeVec = (v: Float32Array) =>
  Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");

const decodeVec = (s: string): Float32Array => {
  const bytes = Buffer.from(s, "base64");
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
};

async function readState(root: string): Promise<State> {
  const key = vaultKey(root);
  const next: State = { root, key, pages: new Map() };

  const raw = await fs.readFile(indexPath(key), "utf8").catch(() => "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredIndex;
      // A different model produces incomparable vectors, so a model change is
      // a full rebuild rather than a silent mix of two vector spaces.
      if (parsed.version === STORE_VERSION && parsed.model === MODEL) {
        for (const [id, page] of Object.entries(parsed.pages)) {
          next.pages.set(id, { hash: page.hash, vectors: page.vectors.map(decodeVec) });
        }
      }
    } catch {
      // A torn index costs a rebuild, which is recoverable. Failing isn't.
    }
  }

  state = next;
  status.indexed = next.pages.size;
  status.ready = next.pages.size > 0 && status.error === null;
  return next;
}

async function loadState(root: string): Promise<State> {
  if (state && state.root === root) return state;
  if (loading && loading.root === root) return loading.promise;
  const promise = readState(root);
  loading = { root, promise };
  try {
    return await promise;
  } finally {
    if (loading?.promise === promise) loading = null;
  }
}

async function save(s: State): Promise<void> {
  const stored: StoredIndex = { version: STORE_VERSION, model: MODEL, pages: {} };
  for (const [id, page] of s.pages) {
    stored.pages[id] = { hash: page.hash, vectors: page.vectors.map(encodeVec) };
  }
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    const tmp = `${indexPath(s.key)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(stored), "utf8");
    await fs.rename(tmp, indexPath(s.key));
  } catch {
    // An unwritable cache costs a rebuild next boot, not a broken feature.
  }
}

// ----------------------------------------------------------------- embedding

async function loadExtractor(): Promise<Extractor | null> {
  if (extractor) return extractor;
  if (extractorLoad) return extractorLoad;
  if (status.error && Date.now() - lastFailureAt < RETRY_MS) return null;

  const attempt = (async (): Promise<Extractor | null> => {
    try {
      await fs.mkdir(MODEL_CACHE, { recursive: true, mode: 0o700 });
      const mod = (await importRuntime("@xenova/transformers")) as Transformers;
      mod.env.cacheDir = MODEL_CACHE;
      const pipe = await mod.pipeline("feature-extraction", MODEL, { quantized: true });
      extractor = pipe;
      status.model = MODEL;
      status.error = null;
      return pipe;
    } catch (error) {
      lastFailureAt = Date.now();
      status.model = null;
      status.error =
        error instanceof Error ? error.message : "Embedding model unavailable.";
      return null;
    } finally {
      extractorLoad = null;
    }
  })();

  extractorLoad = attempt;
  return attempt;
}

async function embed(texts: string[]): Promise<Float32Array[] | null> {
  const pipe = await loadExtractor();
  if (!pipe) return null;
  const out: Float32Array[] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      // Normalised at source, so every later comparison is a plain dot product.
      const result = await pipe(slice, { pooling: "mean", normalize: true });
      const dim = result.dims[result.dims.length - 1];
      for (let j = 0; j < slice.length; j++) {
        out.push(result.data.slice(j * dim, (j + 1) * dim));
      }
    }
  } catch (error) {
    lastFailureAt = Date.now();
    status.error = error instanceof Error ? error.message : "Embedding failed.";
    return null;
  }
  return out;
}

/**
 * Split a page into overlapping windows, each prefixed with the page title.
 *
 * One vector per page is useless above a few hundred words: mean-pooling a
 * 5,000-word page averages away every specific thing in it, which is exactly
 * what a search is looking for. The title prefix keeps a chunk from the middle
 * of a long page anchored to its subject, since the chunk itself often never
 * repeats it.
 */
function chunkPage(title: string, text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // Past the chunk cap the windows spread out instead of stopping, so a
  // 20,000-word page stays searchable to its end. Widened stride leaves small
  // gaps between windows; covering all of a page with gaps beats covering the
  // first seventh of it perfectly and finding nothing below that.
  const stride = Math.max(
    CHUNK_WORDS - CHUNK_OVERLAP,
    Math.ceil((words.length - CHUNK_WORDS) / (MAX_CHUNKS_PER_PAGE - 1)),
  );
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < MAX_CHUNKS_PER_PAGE; i += stride) {
    out.push(`${title}\n${words.slice(i, i + CHUNK_WORDS).join(" ")}`);
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ------------------------------------------------------------------ indexing

type SourcePage = { id: string; title: string; text: string };

/**
 * How long to stand aside between pages during a background build.
 *
 * The whole build is a background nicety; every request that lands during it is
 * something a person is waiting on. When the two compete, the person wins.
 */
const BUILD_PAUSE_MS = 12;

async function runBuild(s: State, stale: SourcePage[]): Promise<void> {
  status.building = true;
  try {
    const pending = new Set(stale.map((p) => p.id));
    let indexed = 0;
    for (const id of s.pages.keys()) if (!pending.has(id)) indexed += 1;
    status.indexed = indexed;

    let sinceSave = 0;
    for (const page of stale) {
      // The user can relink a different vault mid-build; its vectors must not
      // be written into this one's file.
      if (state !== s) return;

      const chunks = chunkPage(page.title, page.text);
      const vectors = chunks.length ? await embed(chunks) : [];
      // Null means the model went away. Its message is already on the status;
      // stopping leaves the partial index intact and searchable.
      if (vectors === null) return;

      s.pages.set(page.id, { hash: hashOf(page.text), vectors });
      status.indexed = ++indexed;
      status.ready = status.error === null;

      if (++sinceSave >= 50) {
        await save(s);
        sinceSave = 0;
      }
      /*
       * Yield, and then wait.
       *
       * `setImmediate` alone hands control back for one tick, which is enough
       * for a request to be *accepted* and not nearly enough for it to be
       * served: embedding is CPU-bound in this same process, so the next page
       * starts before the handler finishes. Measured when this build was made
       * automatic, the brief went from 1.4 seconds to 56.
       *
       * A real pause between pages costs the build wall-clock time and costs
       * the user nothing, which is the correct trade for work nobody asked for
       * and nothing is waiting on. `idle` is small enough that a 1,600-page
       * vault still finishes inside a session.
       */
      await new Promise<void>((resolve) => setTimeout(resolve, BUILD_PAUSE_MS));
    }
    await save(s);
  } finally {
    status.building = false;
  }
}

/**
 * Bring the index up to date with the vault, without blocking the caller.
 *
 * Only pages whose content hash changed are re-embedded. Re-embedding 1,400
 * pages on every boot would take minutes of CPU to produce byte-identical
 * vectors, so the hash is the whole point of persisting the index at all.
 */
export async function ensureIndex(root: string, pages: SourcePage[]): Promise<void> {
  const s = await loadState(root);
  status.total = pages.length;

  const live = new Set(pages.map((p) => p.id));
  let dropped = false;
  for (const id of [...s.pages.keys()]) {
    if (!live.has(id)) {
      s.pages.delete(id);
      dropped = true;
    }
  }

  const stale = pages.filter((p) => s.pages.get(p.id)?.hash !== hashOf(p.text));
  if (!stale.length) {
    status.indexed = s.pages.size;
    status.ready = s.pages.size > 0 && status.error === null;
    if (dropped) await save(s);
    return;
  }

  // A second concurrent build would only fight the first for the CPU. But the
  // running one was handed a fixed list and will never see a page edited since
  // it started, so dropping this call outright would silently leave that edit
  // out of the index until something happened to call again. Hold the newest
  // page set and re-check once the current build drains.
  if (building) {
    queued = pages;
    return;
  }
  building = runBuild(s, stale)
    .catch(() => {})
    .finally(() => {
      building = null;
      const next = queued;
      queued = null;
      // Skip the re-check if the vault changed under us; the new vault's own
      // ensureIndex drives its index, and this call's root is the old one.
      if (next && state === s) void ensureIndex(root, next);
    });
}

// -------------------------------------------------------------------- search

export async function semanticSearch(
  root: string,
  query: string,
  limit = 10,
): Promise<{ id: string; score: number }[]> {
  const q = query.trim();
  if (!q) return [];

  const s = await loadState(root);
  if (!s.pages.size) return [];

  // Embedding the query needs the model in memory. On the very first call that
  // means a ~23MB download, which must not hang a search request — start it and
  // answer with nothing, so the caller falls back to literal search this time.
  if (!extractor) {
    void loadExtractor();
    return [];
  }

  const embedded = await embed([q]);
  const qv = embedded?.[0];
  if (!qv) return [];

  const out: { id: string; score: number }[] = [];
  for (const [id, page] of s.pages) {
    let best = -1;
    for (const vec of page.vectors) {
      const score = dot(qv, vec);
      if (score > best) best = score;
    }
    // Best chunk wins: a page is relevant if any part of it is, and averaging
    // that against the rest of a long page buries it.
    if (best >= MIN_SCORE) out.push({ id, score: best });
  }

  out.sort((a, b) => b.score - a.score);
  if (!out.length) return [];

  // Relative gate: the best hit for THIS query sets the bar for the rest. With
  // an uncalibrated symmetric model the useful signal is the gap between
  // candidates, not their absolute value — a top hit of 0.12 with a runner-up
  // at 0.11 means both are plausible; 0.60 against 0.15 means only one is.
  const cutoff = out[0].score * RELATIVE_CUTOFF;
  return out.filter((r) => r.score >= cutoff).slice(0, limit);
}

/**
 * Pages similar to a given one. Runs entirely off stored vectors, so it needs
 * no model in memory and no download — a cold process can answer this.
 *
 * Cost is every source chunk against every stored chunk. On a 1,400-page vault
 * of ordinary pages that is single-digit milliseconds; comparing one very long
 * page against a vault of very long pages is half a second, which is why the
 * chunk cap exists.
 */
export async function relatedTo(
  root: string,
  pageId: string,
  limit = 8,
): Promise<{ id: string; score: number }[]> {
  const s = await loadState(root);
  const source = s.pages.get(pageId);
  if (!source || !source.vectors.length) return [];

  const out: { id: string; score: number }[] = [];
  for (const [id, page] of s.pages) {
    if (id === pageId) continue;
    let best = -1;
    for (const a of source.vectors) {
      for (const b of page.vectors) {
        const score = dot(a, b);
        if (score > best) best = score;
      }
    }
    if (best >= MIN_RELATED) out.push({ id, score: best });
  }

  out.sort((a, b) => b.score - a.score);
  if (!out.length) return [];

  // Relative gate: the best hit for THIS query sets the bar for the rest. With
  // an uncalibrated symmetric model the useful signal is the gap between
  // candidates, not their absolute value — a top hit of 0.12 with a runner-up
  // at 0.11 means both are plausible; 0.60 against 0.15 means only one is.
  const cutoff = out[0].score * RELATIVE_CUTOFF;
  return out.filter((r) => r.score >= cutoff).slice(0, limit);
}
