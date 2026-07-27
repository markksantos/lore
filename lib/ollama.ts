/**
 * Local generative models, via Ollama.
 *
 * Some of the jobs Lore wants a model for — summarising a page, proposing
 * tags, fixing a title — are small, repetitive, and run over the contents of
 * a private wiki. Those are exactly the jobs that should not leave the machine
 * or spend frontier tokens, so Lore talks to whatever Ollama already has.
 *
 * Lore detects Ollama, it never ships it: the runtime is ~1.5 GB and bundling
 * someone else's installer is a support burden Lore has no way to honour. (LM
 * Studio is detect-only for a harder reason — its licence forbids
 * redistribution.) If Ollama is absent, the local features are simply absent;
 * nothing else in the app depends on them.
 */

/** Ollama's fixed loopback address. Not configurable — this is its default. */
export const OLLAMA_HOST = "http://127.0.0.1:11434";

export type OllamaModel = { name: string; size: number };

type TagsBody = { models?: unknown };

/**
 * Strip an `hf.co/user/` prefix so a community upload cannot pass itself off
 * as an official tag: `hf.co/someone/supergemma4-26b` contains "gemma4" but is
 * not Google's Gemma 4, and recommending it on a substring match would put an
 * unknown fine-tune in front of the user under Google's name.
 */
function tagBase(name: string): string {
  const slash = name.lastIndexOf("/");
  return (slash === -1 ? name : name.slice(slash + 1)).toLowerCase();
}

/** True for an official Gemma 4 tag (`gemma4:latest`, `gemma4:12b`, …). */
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
        error: "Ollama is listening but did not answer within 2.5s.",
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
export async function generate(
  model: string,
  prompt: string,
  opts?: { system?: string; timeoutMs?: number },
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
        options: { temperature: 0.1 },
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
