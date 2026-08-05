/**
 * Local generative models, via Ollama.
 *
 * Some of the jobs Lore wants a model for — summarising a page, proposing
 * tags, fixing a title — are small, repetitive, and run over the contents of
 * a private wiki. Those are exactly the jobs that should not leave the machine
 * or spend frontier tokens, so Lore talks to whatever Ollama already has.
 *
 * Lore detects Ollama, it never ships it: the runtime is ~1.5 GB and bundling
 * someone else's installer is a support burden Lore has no way to honour.
 * Ollama is the only runtime Lore looks for — there is no probe here for LM
 * Studio or any other local server. If Ollama is absent, the local features are
 * simply absent; nothing else in the app depends on them.
 */

/** Ollama's fixed loopback address. Not configurable — this is its default. */
export const OLLAMA_HOST = "http://127.0.0.1:11434";

export type OllamaModel = { name: string; size: number };

type TagsBody = { models?: unknown };

/**
 * Strip an `hf.co/user/` prefix so the match reads the tag's own name instead
 * of the whole path: `hf.co/someone/supergemma4-26b` contains "gemma4" but is
 * not Google's Gemma 4, and recommending it on a substring match would put an
 * unknown fine-tune in front of the user under Google's name. This is a
 * name check, not a provenance check — a community upload whose name *starts*
 * with "gemma4" still matches, and nothing here can tell the two apart.
 */
function tagBase(name: string): string {
  const slash = name.lastIndexOf("/");
  return (slash === -1 ? name : name.slice(slash + 1)).toLowerCase();
}

/** True when the tag's own name is a Gemma 4 one (`gemma4:latest`, `gemma4:12b`, …). */
export function isGemmaTag(name: string): boolean {
  return tagBase(name).startsWith("gemma4");
}

/**
 * A base model continues text; an instruction-tuned one answers it. Every
 * prompt in Lore is an instruction, so this distinction decides whether the
 * output is a summary or the next paragraph of the page.
 */
const INSTRUCT_TUNED = /(?:^|[-:_])(?:instruct|it|chat)(?:$|[-:_.])/;

/**
 * Is Ollama up, and what is installed?
 *
 * `running: false, error: null` is the ordinary case — most machines never
 * install Ollama, and the UI treats that as an option not taken rather than a
 * fault. `error` is reserved for a server that is there and misbehaving,
 * because that is the only case where the user has something to fix.
 */
export async function detectOllama(): Promise<{
  running: boolean;
  models: OllamaModel[];
  error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        running: false,
        models: [],
        error: `Ollama answered ${response.status} on /api/tags.`,
      };
    }
    const body = (await response.json()) as TagsBody;
    const raw = Array.isArray(body.models) ? body.models : [];
    const models: OllamaModel[] = [];
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const { name, size } = entry as { name?: unknown; size?: unknown };
      if (typeof name !== "string" || name.length === 0) continue;
      models.push({ name, size: typeof size === "number" ? size : 0 });
    }
    // Alphabetical, not Ollama's most-recently-modified order: a picker that
    // reorders itself between visits is a picker you have to re-read.
    models.sort((a, b) => a.name.localeCompare(b.name));
    return { running: true, models, error: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        running: false,
        models: [],
        error: "Nothing answered on the Ollama port within 2.5s.",
      };
    }
    return { running: false, models: [], error: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which installed model Lore should use by default.
 *
 * Ordering, most preferred first:
 *  1. `gemma4:12b` exactly. Gemma 4 (Apache-2.0, April 2026) is the newest
 *     open-weight family these prompts were written against, and 12B is the
 *     largest variant that still leaves room for a browser on a 16 GB machine.
 *  2. Any other 12B Gemma 4 tag, then the smallest Gemma 4 tag — smaller means
 *     faster, and every job here produces one sentence.
 *  3. Any instruction-tuned model, smallest first. A base model would continue
 *     the prompt instead of answering it, which no amount of post-processing
 *     can repair.
 *  4. null. Naming a model that will return garbage is worse than saying the
 *     machine has nothing suitable installed.
 */
export function recommendModel(models: OllamaModel[]): string | null {
  const gemma = models.filter((m) => isGemmaTag(m.name));
  if (gemma.length > 0) {
    const exact = gemma.find((m) => m.name === "gemma4:12b");
    if (exact) return exact.name;
    const twelve = gemma
      .filter((m) => /(?:^|[-:])12b/.test(tagBase(m.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (twelve.length > 0) return twelve[0].name;
    return [...gemma].sort((a, b) => a.size - b.size)[0].name;
  }

  const instruct = models
    .filter((m) => INSTRUCT_TUNED.test(tagBase(m.name)))
    .sort((a, b) => a.size - b.size);
  return instruct[0]?.name ?? null;
}

/**
 * A reasoning model's scratchpad is not part of its answer, and several tags
 * emit one whether or not you asked. Removing it here rather than in each
 * caller keeps `generate`'s contract simple: what comes back is the reply.
 * An unclosed block means the model was still thinking when it stopped, which
 * leaves an empty string — callers already treat that as unusable.
 */
function stripThinking(text: string): string {
  return text
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(think|thinking|reasoning)>[\s\S]*$/i, "")
    .trim();
}

/**
 * Run one prompt to completion.
 *
 * `stream: false` because every response here is a sentence — streaming would
 * add plumbing for no perceptible gain. The timeout is the important part: a
 * local model that starts swapping can stall for minutes, and an app that
 * hangs waiting on an optional feature is worse than one that admits defeat.
 */

/**
 * Size the model's context window to the prompt, instead of taking its default.
 *
 * Measured on this machine, gemma4:12b loads with `num_ctx` 131,072 — so
 * answering a 3,000-token question made Ollama stand up a KV cache for a
 * hundred and thirty-one thousand. The cost is real and it is mostly hidden in
 * prompt evaluation: 12.8s and 10.8s at the default, against 6.2s and 6.6s at
 * num_ctx 8192 for byte-identical work. The variance collapses too, which
 * matters more than the mean — a feature that takes 11s or 26s unpredictably
 * feels broken in a way a steady 7s does not.
 *
 * Sized generously on purpose. If the window is smaller than the prompt Ollama
 * silently truncates, and a silently truncated prompt is a wrong answer with no
 * error — far worse than a slow one. So: estimate tokens at three characters
 * each (markdown tokenizes worse than prose, so this over-estimates, which is
 * the safe direction), add room for the answer, then round up to the next
 * bucket and clamp.
 */
export function contextFor(prompt: string, system = "", reserveForAnswer = 1_024): number {
  /*
   * Two and a half characters per token, not four.
   *
   * Four is right for English prose and wrong for what actually goes in here:
   * a context pack is markdown full of paths, code spans, tables and IDs, all
   * of which tokenize far worse. The regression test in
   * scripts/test-write-feedback.mjs pins the invariant — the window must still
   * fit the prompt even at a pessimistic two chars per token — and it failed at
   * a divisor of three, which is exactly the near-miss that would have shipped
   * as a silently truncated answer.
   */
  const estimated = Math.ceil((prompt.length + system.length) / 2.5) + reserveForAnswer;
  /*
   * The floor is 8,192, not 2,048.
   *
   * Not because small windows are slow — measured, alternating between 4,096
   * and 8,192 costs nothing, and Ollama does not reload on a change. It is
   * because there is no gain to claim: memory is ample, and fewer distinct
   * window sizes means fewer chances for a future caller to trip a reload that
   * this measurement did not happen to cover.
   */
  for (const bucket of [8_192, 16_384, 32_768, 65_536]) {
    if (estimated <= bucket) return bucket;
  }
  // Beyond this, hand it back to the model's own default rather than guess.
  return 131_072;
}

export async function generate(
  model: string,
  prompt: string,
  opts?: { system?: string; timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        system: opts?.system,
        stream: false,
        // Reasoning off. Measured on gemma4:12b: a one-sentence summary took
        // 2,591 tokens and 86 seconds with thinking on, and 20 tokens and 0.7
        // seconds with it off — for the same sentence. These jobs have nothing
        // to reason about. Ollama accepts `think: false` on models that cannot
        // think at all (verified against a completion-only tag), so this is
        // safe to send unconditionally.
        think: false,
        // Near-greedy. Every job here extracts something already present in
        // the page; sampling temperature is what makes a small model invent a
        // tag the document never mentions.
        options: {
          temperature: 0.1,
          num_ctx: contextFor(prompt, opts?.system ?? ""),
          /*
           * A backstop, not a truncator. A good answer here measures under a
           * hundred tokens; this only stops a model that has started rambling,
           * which is the failure that turns a 4-second answer into a 31-second
           * one. Callers needing long output pass their own limit.
           */
          num_predict: opts?.maxTokens ?? 600,
        },
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      response?: unknown;
      error?: unknown;
    } | null;

    if (!response.ok || typeof body?.error === "string") {
      const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(`Ollama refused the request: ${detail}`);
    }
    if (typeof body?.response !== "string") {
      throw new Error("Ollama returned a response with no text in it.");
    }
    return stripThinking(body.response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${model} did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    }
    if (error instanceof Error && error.message.startsWith("Ollama")) throw error;
    throw new Error(`Could not reach Ollama at ${OLLAMA_HOST}.`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate with the tokens delivered as they arrive.
 *
 * Ask waits on a local model for several seconds even when everything is warm,
 * and a spinner for six seconds reads as broken while six seconds of text reads
 * as thinking. Nothing else changes: same model, same prompt, same total time —
 * only the moment the user stops wondering whether it is working.
 *
 * `onToken` is called with each fragment. It must not throw; a display callback
 * that fails should not abort a generation the user is watching.
 */
export async function generateStream(
  model: string,
  prompt: string,
  onToken: (chunk: string) => void,
  opts?: { system?: string; timeoutMs?: number; signal?: AbortSignal; maxTokens?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 120_000);
  /*
   * The caller's signal aborts the fetch too. Without this, a client that
   * disconnected mid-answer left the generation running to completion — the
   * inference slot stayed occupied and the machine spent up to two minutes
   * producing tokens for a socket that was already closed.
   */
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let full = "";

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        system: opts?.system,
        stream: true,
        think: false,
        options: {
          temperature: 0.1,
          num_ctx: contextFor(prompt, opts?.system ?? ""),
          num_predict: opts?.maxTokens ?? 600,
        },
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Ollama refused the request: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Ollama emits one JSON object per line, and a chunk boundary can land
      // mid-object — so the last fragment is always held back for the next read.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { response?: string; done?: boolean };
          if (typeof parsed.response === "string" && parsed.response) {
            full += parsed.response;
            try {
              onToken(parsed.response);
            } catch {
              // A failing display must not abort the generation behind it.
            }
          }
        } catch {
          // A line we cannot parse costs one fragment, not the answer.
        }
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------- vision

/**
 * What a model can actually do, according to Ollama.
 *
 * Guessing from the tag name was the alternative and it is wrong in both
 * directions: `llama3.2-vision` is obvious, `gemma4` is not (it sees), and a
 * community fine-tune can be named anything at all. `/api/show` reports a
 * `capabilities` array — "vision", "tools", "thinking" — which is the model's
 * own answer rather than ours.
 *
 * Cached for the process. Capabilities do not change under a running server,
 * and this is called before every screen frame is described.
 */
const capabilityCache = new Map<string, string[]>();

export async function modelCapabilities(model: string): Promise<string[]> {
  const cached = capabilityCache.get(model);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ model }),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { capabilities?: unknown };
    const caps = Array.isArray(body.capabilities)
      ? body.capabilities.filter((c): c is string => typeof c === "string")
      : [];
    capabilityCache.set(model, caps);
    return caps;
  } catch {
    /* Not cached: a timeout is a transient condition, and caching it would
       leave vision permanently "absent" after one slow moment at boot. */
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Above this, a vision model cannot keep up with the shutter.
 *
 * Ghost captures every fifteen seconds and describes what changed. On this
 * machine the installed models are a 39 GB Qwen and a 10 GB Gemma; the Qwen is
 * the better reader and takes long enough per frame that the queue grows
 * faster than it drains, so the "best" model produces a permanent backlog and
 * evicts whatever Ask had resident. Twenty-four gigabytes is the line between
 * a model that answers between frames and one that does not.
 */
const VISION_SIZE_CEILING = 24 * 1024 ** 3;

/**
 * The best installed model that can look at an image AND keep up.
 *
 * Largest first, unlike recommendModel's smallest-first: describing a
 * screenshot is a comprehension task where a small model produces confident
 * nonsense, and Ghost's whole value is that its notes are true. But largest
 * WITHIN the ceiling — an enormous model that falls permanently behind
 * describes fewer frames correctly than a smaller one that finishes.
 *
 * If everything installed is over the ceiling, the smallest of them is used
 * rather than none: a slow description is still better than a blank note.
 */
export async function pickVisionModel(models: OllamaModel[]): Promise<string | null> {
  const capable: OllamaModel[] = [];
  for (const model of models) {
    const caps = await modelCapabilities(model.name);
    if (caps.includes("vision")) capable.push(model);
  }
  if (!capable.length) return null;

  const affordable = capable.filter((model) => model.size > 0 && model.size <= VISION_SIZE_CEILING);
  if (affordable.length) {
    return [...affordable].sort((a, b) => b.size - a.size)[0].name;
  }
  /* A size of zero means Ollama did not report one; treat it as unknown rather
     than as free, and fall in behind anything with a real measurement. */
  return [...capable].sort((a, b) => (a.size || Infinity) - (b.size || Infinity))[0].name;
}

/**
 * Describe an image with a local vision model.
 *
 * `images` takes bare base64 — no data-URL prefix, which Ollama rejects with a
 * decode error rather than a helpful message. The timeout is generous because
 * a vision prompt on a cold model can take a minute on the first frame and
 * three seconds on every one after it.
 */
export async function describeImage(
  model: string,
  imageBase64: string,
  prompt: string,
  opts?: { system?: string; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 120_000);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        system: opts?.system,
        stream: false,
        think: false,
        options: {
          temperature: 0.1,
          /* No num_ctx here. A vision prompt's real length is the image's token
             expansion, which this side cannot estimate — contextFor would size
             the window from the text alone and silently truncate the picture. */
          num_predict: opts?.maxTokens ?? 400,
        },
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      response?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || typeof body?.error === "string") {
      const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(`Ollama refused the image: ${detail}`);
    }
    if (typeof body?.response !== "string") throw new Error("Ollama returned no description.");
    return stripThinking(body.response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${model} did not describe the frame in time.`);
    }
    throw error instanceof Error ? error : new Error("Could not reach Ollama.");
  } finally {
    clearTimeout(timer);
  }
}
