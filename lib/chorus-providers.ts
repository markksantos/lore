import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OLLAMA_HOST } from "@/lib/ollama";

/**
 * The four ways Lore can talk to a model that is not on this machine.
 *
 * Chorus is the one feature in Lore that deliberately leaves the laptop. That
 * is the point of it — the value is in the disagreement between models built by
 * different companies on different data, and you cannot get that from one
 * machine's Ollama. So this module exists, it is the only place where something
 * the user wrote is handed to a company that is not them, and it is written to
 * be auditable in one sitting for exactly that reason.
 *
 * Not "the only module that opens a socket", which is what this comment said
 * until a reviewer checked: lib/enrich.ts fetches a URL you pasted so it can
 * title it, and lib/collab.ts posts to a webhook you configured. Both are
 * network calls. Neither sends your writing anywhere. The distinction is the
 * whole point of the claim, so the claim has to make it.
 *
 * Four APIs, four wire formats, one function. Each provider streams
 * line-delimited JSON over SSE and each spells the same three concepts
 * differently, so the differences are isolated in `parseChunk` and everything
 * above it works in tokens.
 *
 * On keys: they are read from the environment first and from a 0600 file
 * second, they are never returned by any endpoint, never logged, and never put
 * in an error message. `configuredProviders()` answers which exist and nothing
 * about what they are.
 */

export type ProviderId = "anthropic" | "openai" | "google" | "openrouter" | "ollama";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  ollama: "This machine",
};

/**
 * Default models, and why they are only defaults.
 *
 * Model names change faster than any file in this repo will, and a hardcoded
 * name that has been retired produces a 404 with a provider's own wording. So
 * every panelist carries its own model string, the settings screen can change
 * it, and the provider's error is surfaced verbatim rather than translated into
 * "something went wrong" — because "model: gpt-5 does not exist" is a sentence
 * the user can act on and a generic failure is not.
 */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  /*
   * Google's is unverified, and deliberately labelled as such.
   *
   * Checked against a live key on the development machine: `gemini-3-pro` does
   * not exist; `gemini-2.5-pro` is returned by the models endpoint and then
   * answers "no longer available to new users"; every current model answers
   * `streamGenerateContent` with a 404 saying "use the Interactions API". So
   * this key cannot reach generateContent at all, and no name could be
   * confirmed from here — being listed is not the same as being callable, which
   * is itself the useful finding.
   *
   * The name below is the most broadly available one. If it fails, Google's own
   * message says what to use instead and the UI shows that message verbatim,
   * which is why none of this is fatal: one dead panelist does not stop a
   * debate, and the model is one field in the panel editor.
   */
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  google: "gemini-2.5-flash",
  openrouter: "openai/gpt-5",
  ollama: "",
};

const KEY_FILE = path.join(os.homedir(), ".lore", "chorus-keys.json");

const ENV_KEYS: Record<ProviderId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [],
};

type KeyFile = Partial<Record<ProviderId, string>>;

async function readKeyFile(): Promise<KeyFile> {
  const raw = await fs.readFile(KEY_FILE, "utf8").catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as KeyFile;
  } catch {
    return {};
  }
}

/**
 * The key for a provider, or null.
 *
 * Environment first. A key exported in the shell that started Lore is the one
 * the user is already managing somewhere else, and silently preferring a stale
 * copy on disk is how "I rotated it and it still fails" happens.
 */
export async function keyFor(provider: ProviderId): Promise<string | null> {
  for (const name of ENV_KEYS[provider]) {
    const value = process.env[name];
    if (value) return value;
  }
  const stored = (await readKeyFile())[provider];
  return stored || null;
}

/** Which providers can be called. Booleans only — never a key, never a prefix. */
export async function providerAvailability(): Promise<
  Record<ProviderId, { configured: boolean; fromEnv: boolean }>
> {
  const file = await readKeyFile();
  const out = {} as Record<ProviderId, { configured: boolean; fromEnv: boolean }>;
  for (const provider of Object.keys(PROVIDER_LABEL) as ProviderId[]) {
    if (provider === "ollama") {
      out.ollama = { configured: true, fromEnv: false };
      continue;
    }
    const fromEnv = ENV_KEYS[provider].some((name) => Boolean(process.env[name]));
    out[provider] = { configured: fromEnv || Boolean(file[provider]), fromEnv };
  }
  return out;
}

/**
 * Store a key on disk at 0600.
 *
 * Offered because the alternative for a desktop-app user is editing a shell
 * profile they may not have, and a feature nobody can turn on is not a feature.
 * The file is created with restrictive permissions BEFORE the key is written to
 * it — `writeFile` with a mode only applies the mode when it creates the file,
 * so a pre-existing 0644 file would keep its permissions and the key would land
 * world-readable.
 */
export async function saveKey(provider: ProviderId, key: string | null): Promise<void> {
  const file = await readKeyFile();
  if (key) file[provider] = key;
  else delete file[provider];
  const dir = path.dirname(KEY_FILE);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const handle = await fs.open(KEY_FILE, "w", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify(file, null, 2) + "\n", "utf8");
  } finally {
    await handle.close();
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult = {
  text: string;
  /** What the provider said it spent, when it says. */
  inputTokens: number | null;
  outputTokens: number | null;
  ms: number;
};

/**
 * Redact anything that looks like a key out of a message we are about to show.
 *
 * Providers echo the offending request back in some error shapes, and this
 * text goes to a screen and into an SSE frame. One regex is cheap insurance
 * against a 401 body that quotes the Authorization header.
 */
function safeError(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, "Bearer [redacted]")
    .slice(0, 600);
}

/**
 * One streamed completion, whichever provider it is.
 *
 * `onToken` is called with each fragment and must not throw. The returned
 * promise resolves with the whole text, so callers that only want the answer
 * can pass a no-op and ignore the streaming entirely.
 */
export async function streamChat(
  provider: ProviderId,
  model: string,
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  opts?: { signal?: AbortSignal; maxTokens?: number; timeoutMs?: number },
): Promise<ChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 180_000);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const key = provider === "ollama" ? null : await keyFor(provider);
    if (provider !== "ollama" && !key) {
      throw new Error(`No API key is configured for ${PROVIDER_LABEL[provider]}.`);
    }

    const request = buildRequest(provider, model, messages, key, opts?.maxTokens ?? 1_400);
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${PROVIDER_LABEL[provider]} refused the request (HTTP ${response.status}). ${safeError(detail)}`.trim(),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* Every one of these formats is newline-delimited, and a network chunk
         can land mid-line. The last fragment is always held back. */
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseChunk(provider, line);
        if (!parsed) continue;
        if (parsed.text) {
          text += parsed.text;
          try {
            onToken(parsed.text);
          } catch {
            /* A failing display must not abort the generation behind it. */
          }
        }
        if (parsed.inputTokens != null) inputTokens = parsed.inputTokens;
        if (parsed.outputTokens != null) outputTokens = parsed.outputTokens;
      }
    }

    return { text, inputTokens, outputTokens, ms: Date.now() - started };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${PROVIDER_LABEL[provider]} did not answer in time.`);
    }
    /*
     * "fetch failed" is not a diagnosis.
     *
     * undici throws exactly that string for every network-layer failure and
     * puts the actual reason — ENOTFOUND, ECONNREFUSED, a TLS error, an
     * unreachable proxy — in `error.cause`. Surfacing only the outer message
     * meant a user behind a corporate proxy and a user with no internet saw the
     * same two words, on a screen whose entire job is to explain why a panelist
     * did not answer.
     */
    if (error instanceof Error) {
      const cause = error.cause as { code?: string; message?: string } | undefined;
      const detail = cause?.code ?? cause?.message;
      return Promise.reject(
        new Error(
          safeError(
            detail ? `${PROVIDER_LABEL[provider]}: ${error.message} (${detail})` : error.message,
          ),
        ),
      );
    }
    throw new Error("Request failed.");
  } finally {
    clearTimeout(timer);
  }
}

function buildRequest(
  provider: ProviderId,
  model: string,
  messages: ChatMessage[],
  key: string | null,
  maxTokens: number,
): { url: string; headers: Record<string, string>; body: unknown } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "content-type": "application/json",
          "x-api-key": key!,
          "anthropic-version": "2023-06-01",
        },
        body: {
          model,
          max_tokens: maxTokens,
          stream: true,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
        },
      };

    case "openai":
    case "openrouter":
      return {
        url:
          provider === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key!}`,
          ...(provider === "openrouter"
            ? { "http-referer": "https://github.com/markksantos/lore", "x-title": "Lore" }
            : {}),
        },
        body: {
          model,
          stream: true,
          /* Usage does not appear in an OpenAI stream unless it is asked for,
             and without it the cost panel reads zero for every cloud panelist. */
          stream_options: { include_usage: true },
          max_completion_tokens: maxTokens,
          messages,
        },
      };

    case "google":
      return {
        /* `alt=sse` is not optional. Without it the streaming endpoint returns
           one enormous JSON array at the end, which parses but never streams —
           the debate would appear all at once, which is the one thing this
           feature exists not to do. */
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key!)}`,
        headers: { "content-type": "application/json" },
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: rest.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
        },
      };

    case "ollama":
      return {
        url: `${OLLAMA_HOST}/api/chat`,
        headers: { "content-type": "application/json" },
        body: {
          model,
          stream: true,
          think: false,
          messages,
          options: { temperature: 0.4, num_predict: maxTokens },
        },
      };
  }
}

type Chunk = { text: string; inputTokens: number | null; outputTokens: number | null } | null;

function parseChunk(provider: ProviderId, line: string): Chunk {
  const trimmed = line.trim();
  if (!trimmed) return null;

  /* Ollama speaks bare JSON lines; the other three speak SSE, where only
     `data:` lines carry payload and `[DONE]` is a sentinel, not JSON. */
  let payload = trimmed;
  if (provider !== "ollama") {
    if (!trimmed.startsWith("data:")) return null;
    payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return null;
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (provider) {
    case "anthropic": {
      const type = json.type as string | undefined;
      if (type === "content_block_delta") {
        const delta = json.delta as { text?: string; type?: string } | undefined;
        return { text: delta?.text ?? "", inputTokens: null, outputTokens: null };
      }
      if (type === "message_start") {
        const usage = (json.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
        return { text: "", inputTokens: usage?.input_tokens ?? null, outputTokens: null };
      }
      if (type === "message_delta") {
        const usage = json.usage as { output_tokens?: number } | undefined;
        return { text: "", inputTokens: null, outputTokens: usage?.output_tokens ?? null };
      }
      if (type === "error") {
        const message = (json.error as { message?: string } | undefined)?.message;
        throw new Error(`Anthropic: ${message ?? "stream error"}`);
      }
      return null;
    }

    case "openai":
    case "openrouter": {
      const choice = (json.choices as { delta?: { content?: string } }[] | undefined)?.[0];
      const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      return {
        text: choice?.delta?.content ?? "",
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
      };
    }

    case "google": {
      const candidate = (
        json.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined
      )?.[0];
      const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const usage = json.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
      return {
        text,
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
      };
    }

    case "ollama": {
      const message = json.message as { content?: string } | undefined;
      return {
        text: message?.content ?? "",
        inputTokens: (json.prompt_eval_count as number | undefined) ?? null,
        outputTokens: (json.eval_count as number | undefined) ?? null,
      };
    }
  }
}

/**
 * Rough dollars, for the line under the debate.
 *
 * Deliberately approximate and labelled as such in the UI. Exact pricing
 * changes per model and per month and is not worth a table that will be wrong;
 * an order of magnitude is what stops somebody convening five frontier models
 * on a whim and being surprised.
 */
const RATE_PER_MTOK: Record<ProviderId, { input: number; output: number }> = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 2.5, output: 10 },
  google: { input: 1.25, output: 5 },
  openrouter: { input: 2.5, output: 10 },
  ollama: { input: 0, output: 0 },
};

export function estimateCost(provider: ProviderId, input: number | null, output: number | null): number {
  const rate = RATE_PER_MTOK[provider];
  return ((input ?? 0) / 1e6) * rate.input + ((output ?? 0) / 1e6) * rate.output;
}
