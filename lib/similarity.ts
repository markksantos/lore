/**
 * Near-duplicate detection over a whole vault.
 *
 * A wiki that agents write into accumulates restatements rather than copies:
 * the same policy lands in three notes, reworded a little each time. Exact
 * matching never sees that, so the signal here is Jaccard overlap of word
 * 3-grams — high when two notes are the same prose lightly edited, low when
 * they merely share a topic and its vocabulary.
 *
 * The cost problem is the whole design. 1500 notes is 1.1M pairs, and running
 * an exact comparison on all of them locks the tab for tens of seconds. So
 * exact Jaccard only ever runs on candidate pairs surfaced by MinHash
 * signatures bucketed with LSH banding, which is linear in documents.
 */

export type DuplicatePair = { a: string; b: string; score: number; shared: string[] };

const SHINGLE_SIZE = 3;

/**
 * Banding parameters. BANDS * ROWS_PER_BAND must equal SIGNATURE_LENGTH: the
 * signature is cut into BANDS slices of ROWS_PER_BAND hashes, and two documents
 * become candidates if any one slice matches exactly.
 *
 * For a pair with true Jaccard s, the chance of that is 1 - (1 - s^rows)^bands,
 * an S-curve whose steep point sits at roughly (1/bands)^(1/rows). With 64
 * bands of 3 that is (1/64)^(1/3) = 0.25 — deliberately *under* the 0.35
 * reporting threshold, because a missed pair is invisible to the user while an
 * extra candidate only costs one exact comparison. The resulting numbers:
 * a pair at s=0.35 is caught ~94% of the time, s=0.5 ~99.9%, while an unrelated
 * pair (s≈0.05) survives banding under 1% of the time — so a 1500-note vault
 * yields on the order of 10k candidates instead of 1.1M comparisons.
 */
const SIGNATURE_LENGTH = 192;
const ROWS_PER_BAND = 3;
const BANDS = SIGNATURE_LENGTH / ROWS_PER_BAND;

/** Longest phrase reported back as evidence, in words. */
const MAX_PHRASE_WORDS = 12;
const MAX_SHARED_PHRASES = 4;

/** 32-bit avalanche (the murmur3 finaliser). Seeded variants of it stand in for
 *  independent hash permutations, which is what MinHash actually needs. */
function mix32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seeds are derived from a fixed constant rather than Math.random so the same
 *  vault produces the same pairs on every reload — a list that reshuffles
 *  between refreshes reads as a bug. */
const SEEDS = (() => {
  const seeds = new Uint32Array(SIGNATURE_LENGTH);
  let state = 0x9e3779b9;
  for (let i = 0; i < SIGNATURE_LENGTH; i++) {
    state = mix32(state + 0x6d2b79f5);
    seeds[i] = state;
  }
  return seeds;
})();

function hashToken(token: string, cache: Map<string, number>): number {
  const cached = cache.get(token);
  if (cached !== undefined) return cached;
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash = Math.imul(hash ^ token.charCodeAt(i), 0x01000193);
  }
  const value = mix32(hash);
  cache.set(token, value);
  return value;
}

/**
 * Words only, lowercased. Markdown punctuation, list bullets and link syntax
 * all collapse to separators, so a note and its reformatted twin shingle
 * identically — formatting churn is not a difference in content.
 */
function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9']*/g);
  return matches ?? [];
}

/** Shingles are hashed from the token hashes rather than from a joined string:
 *  a 1500-note vault has ~450k shingles, and materialising that many strings
 *  costs more than the entire MinHash pass. */
function shingleSet(tokens: string[], cache: Map<string, number>): Set<number> {
  const shingles = new Set<number>();
  if (tokens.length < SHINGLE_SIZE) return shingles;
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i++) {
    let hash = 0x9e3779b1;
    for (let k = 0; k < SHINGLE_SIZE; k++) {
      hash = mix32(hash ^ Math.imul(hashToken(tokens[i + k], cache), 0x85ebca6b));
    }
    shingles.add(hash);
  }
  return shingles;
}

function minHashSignature(shingles: Set<number>): Uint32Array {
  const signature = new Uint32Array(SIGNATURE_LENGTH).fill(0xffffffff);
  for (const shingle of shingles) {
    for (let i = 0; i < SIGNATURE_LENGTH; i++) {
      const hashed = mix32(shingle ^ SEEDS[i]);
      if (hashed < signature[i]) signature[i] = hashed;
    }
  }
  return signature;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) if (large.has(value)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * The evidence: runs of matching 3-grams, merged back into readable phrases.
 *
 * Adjacent shingles overlap by two words, so a run of consecutive hits is one
 * continuous shared passage — reporting it whole is what turns "these look
 * similar" into "these two say this same sentence".
 */
function sharedPhrases(tokensA: string[], tokensB: string[]): string[] {
  const cache = new Map<string, number>();
  const setA = shingleSet(tokensA, cache);
  if (setA.size === 0 || tokensB.length < SHINGLE_SIZE) return [];

  const phrases: string[] = [];
  let runStart = -1;

  const flush = (end: number) => {
    if (runStart < 0) return;
    // A run from shingle `runStart` to shingle `end` covers tokens
    // runStart .. end + SHINGLE_SIZE - 1.
    const words = tokensB.slice(runStart, Math.min(end + SHINGLE_SIZE, runStart + MAX_PHRASE_WORDS));
    phrases.push(words.join(" "));
    runStart = -1;
  };

  for (let i = 0; i + SHINGLE_SIZE <= tokensB.length; i++) {
    let hash = 0x9e3779b1;
    for (let k = 0; k < SHINGLE_SIZE; k++) {
      hash = mix32(hash ^ Math.imul(hashToken(tokensB[i + k], cache), 0x85ebca6b));
    }
    if (setA.has(hash)) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i - 1);
    }
  }
  flush(tokensB.length - SHINGLE_SIZE);

  // Longest first: the longest shared passage is the most convincing evidence,
  // and a wall of three-word fragments is evidence of nothing.
  const seen = new Set<string>();
  return phrases
    .sort((x, y) => y.length - x.length)
    .filter((phrase) => {
      if (seen.has(phrase)) return false;
      seen.add(phrase);
      return true;
    })
    .slice(0, MAX_SHARED_PHRASES);
}

/**
 * Pairs of documents whose 3-gram Jaccard is at or above `threshold`, highest
 * overlap first, each carrying a few phrases the two genuinely share.
 *
 * Titles are folded into the text because two notes named the same thing about
 * the same thing are exactly the case this screen exists to catch, and a short
 * note's title carries a real share of its content.
 */
export function findNearDuplicates(
  docs: { id: string; title: string; text: string }[],
  threshold = 0.35,
): DuplicatePair[] {
  const tokenCache = new Map<string, number>();
  const shingles: Set<number>[] = [];
  const signatures: (Uint32Array | null)[] = [];

  for (const doc of docs) {
    const tokens = tokenize(`${doc.title} ${doc.text}`);
    const set = shingleSet(tokens, tokenCache);
    shingles.push(set);
    // Too short to shingle: no signature, so it never enters a bucket and is
    // silently ignored rather than matching every other stub.
    signatures.push(set.size === 0 ? null : minHashSignature(set));
  }

  // One bucket map for all bands; the band index is folded into the key, so a
  // cross-band collision only ever costs an extra exact comparison.
  const buckets = new Map<number, number[]>();
  for (let doc = 0; doc < docs.length; doc++) {
    const signature = signatures[doc];
    if (!signature) continue;
    for (let band = 0; band < BANDS; band++) {
      let key = mix32(0x811c9dc5 ^ band);
      for (let row = 0; row < ROWS_PER_BAND; row++) {
        key = mix32(key ^ signature[band * ROWS_PER_BAND + row]);
      }
      const bucket = buckets.get(key);
      if (bucket) bucket.push(doc);
      else buckets.set(key, [doc]);
    }
  }

  const candidates = new Set<number>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        candidates.add(bucket[i] * docs.length + bucket[j]);
      }
    }
  }

  const pairs: DuplicatePair[] = [];
  for (const key of candidates) {
    const i = Math.floor(key / docs.length);
    const j = key % docs.length;
    const score = jaccard(shingles[i], shingles[j]);
    if (score < threshold) continue;
    pairs.push({
      a: docs[i].id,
      b: docs[j].id,
      score,
      // Re-tokenised on demand: only surviving pairs need phrases, and holding
      // every document's token array through the whole run costs far more
      // memory than re-splitting a handful of documents costs time.
      shared: sharedPhrases(
        tokenize(`${docs[i].title} ${docs[i].text}`),
        tokenize(`${docs[j].title} ${docs[j].text}`),
      ),
    });
  }

  return pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
}
