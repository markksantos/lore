import { fail } from "@/lib/server";
import {
  detectOllama,
  generate,
  isGemmaTag,
  OLLAMA_HOST,
  recommendModel,
  type OllamaModel,
} from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The three jobs Lore hands to a local model.
 *
 * All three are extraction, not authorship: they compress something the page
 * already says. That is what a 12B model on a laptop is genuinely good at, and
 * it is why none of this needs to touch a paid API.
 */

/**
 * How much of a page the model sees. A local model's speed falls off with
 * prompt length long before its context window runs out, and a wiki page
 * states its subject in the first few paragraphs — so the tail buys latency,
 * not accuracy.
 */
const MAX_INPUT_CHARS = 6_000;

/** Existing tags are a menu, not a corpus; a huge list crowds out the page. */
const MAX_EXISTING_TAGS = 80;

/**
 * Longer than the library default because the first request of a session pays
 * for reading the weights off disk — about a minute for a 10 GB model — before
 * a single token is generated. Generation itself takes under a second.
 */
const TIMEOUT_MS = 150_000;

const GB = (bytes: number) => (bytes / 1e9).toFixed(1);

/**
 * Small models open with a courtesy line — "Sure! Here is the summary:" — no
 * matter how firmly the prompt forbids it. Only openers are stripped, and only
 * ones that begin with a known filler word, so a real sentence containing a
 * colon survives intact.
 */
const PREAMBLE =
  /^\s*(?:sure|okay|ok|certainly|of course|absolutely|here(?:'s| is| are)[^:\n]{0,60}|the (?:summary|title|tags?)[^:\n]{0,40}|answer|summary|title|tags)\s*[:\-—]\s*/i;

/** ```json fences arrive uninvited around anything structured. */
function stripFences(text: string): string {
  const fenced = text.match(/^```[a-z]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i);
  return fenced ? fenced[1].trim() : text;
}

function clean(raw: string): string {
  let text = stripFences(raw.trim());
  // Badly-converted GGUF tags leak their chat control tokens into the body —
  // one installed model here opens every reply with "<|channel>thought". These
  // are never content, and leaving them in would ship a template artefact as a
  // page title.
  text = text.replace(/^(?:<\|?[^<>\n]{0,40}\|?>\s*)+/, "").trim();
  text = text.replace(PREAMBLE, "").trim();
  // Models quote anything they think of as "the answer".
  text = text.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "");
  return text.trim();
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).replace(/\s+/g, " ").trim();
}

/** One sentence, 20 words. The word cap is enforced here because the model won't. */
function toSummary(raw: string): string | null {
  const sentence = firstSentence(firstLine(clean(raw)));
  const words = sentence.split(/\s+/).filter(Boolean);
  // Under three words is not a summary, it is a fragment or a refusal.
  if (words.length < 3) return null;
  if (words.length <= 20) return sentence;
  // Clipping beats rejecting: the opening 20 words of a one-sentence summary
  // still say what the page is, and the ellipsis admits it was cut.
  return `${words.slice(0, 20).join(" ").replace(/[,;:]$/, "")}…`;
}

function toTitle(raw: string): string | null {
  const line = firstLine(clean(raw))
    .replace(/^#{1,6}\s*/, "")
    .replace(/[.,:;]+$/, "")
    .trim();
  // A title long enough to be a paragraph means the model answered a different
  // question, and no cleanup turns that into a title.
  if (!line || line.length > 90 || !/[a-z0-9]/i.test(line)) return null;
  return line;
}

/** `Some Tag` and `#some tag` both mean `some-tag`. */
function normaliseTag(value: string): string | null {
  const tag = value
    .trim()
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^["'#]+|["',.]+$/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return /^[a-z0-9][a-z0-9\-_/]{0,31}$/.test(tag) ? tag : null;
}

function toTags(raw: string, existing: string[]): string[] | null {
  const text = clean(raw);
  let items: string[] = [];

  const open = text.indexOf("[");
  const close = text.lastIndexOf("]");
  if (open !== -1 && close > open) {
    try {
      const parsed: unknown = JSON.parse(text.slice(open, close + 1));
      if (Array.isArray(parsed)) items = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // Fall through to the line parser below — a malformed array is still
      // usually a readable list.
    }
  }

  if (items.length === 0) {
    // The common failure is a bullet or comma list instead of JSON. That is
    // recoverable; anything longer than four words per item is prose, and gets
    // dropped by normaliseTag rather than guessed at.
    items = text.split(/[\n,]/).filter((part) => part.trim().split(/\s+/).length <= 4);
  }

  // Reuse beats invention: an existing tag already has pages behind it, so a
  // near-miss synonym fragments the vault. Matching is done on the normalised
  // form but the vault's own spelling is what gets returned.
  const known = new Map<string, string>();
  for (const tag of existing) {
    const key = normaliseTag(tag);
    if (key) known.set(key, tag);
  }

  const out: string[] = [];
  for (const item of items) {
    const tag = normaliseTag(item);
    if (!tag) continue;
    const value = known.get(tag) ?? tag;
    if (!out.includes(value)) out.push(value);
    if (out.length === 6) break;
  }
  return out.length > 0 ? out : null;
}

/** Why Lore points at this model — shown in the UI next to the picker. */
function whyRecommended(name: string | null, models: OllamaModel[]): string | null {
  if (!name) {
    if (models.length === 0) return null;
    return "None of the installed models are instruction-tuned, so they would continue these prompts instead of answering them.";
  }
  const size = models.find((m) => m.name === name)?.size ?? 0;
  if (isGemmaTag(name)) {
    return `Gemma 4 is Apache-2.0 and instruction-tuned, and this tag loads in about ${GB(size)} GB — small enough to run beside everything else on the machine.`;
  }
  return `The smallest instruction-tuned model installed (about ${GB(size)} GB) — every job here is one sentence, so smaller is faster. These prompts were written against Gemma 4: ollama pull gemma4:12b.`;
}

/** GET — what is installed, and what Lore would use. */
export async function GET() {
  const detection = await detectOllama();
  const recommended = recommendModel(detection.models);
  return Response.json({
    host: OLLAMA_HOST,
    running: detection.running,
    models: detection.models,
    error: detection.error,
    recommended,
    reason: whyRecommended(recommended, detection.models),
  });
}

type Body = {
  task?: unknown;
  text?: unknown;
  model?: unknown;
  existing?: unknown;
};

/** POST — run one task on the local model. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const task = body.task;
    if (task !== "summarize" && task !== "tags" && task !== "title") {
      return fail(new Error("Unknown task. Expected summarize, tags, or title."));
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 40) {
      return fail(new Error("Not enough text to work with."));
    }

    let model = typeof body.model === "string" && body.model ? body.model : null;
    if (!model) {
      const detection = await detectOllama();
      if (!detection.running) {
        return fail(new Error(`No local model is running. Start Ollama at ${OLLAMA_HOST}.`), 503);
      }
      model = recommendModel(detection.models);
      if (!model) return fail(new Error("No suitable local model is installed."), 503);
    }

    const excerpt = text.slice(0, MAX_INPUT_CHARS);

    if (task === "summarize") {
      const raw = await generate(
        model,
        `Summarise this wiki page in one sentence of at most 20 words.\n\n---\n${excerpt}\n---`,
        {
          system:
            "You summarise documents. Reply with exactly one sentence of at most 20 words, in plain text. No preamble, no quotes, no markdown, no lists.",
          timeoutMs: TIMEOUT_MS,
        },
      );
      const summary = toSummary(raw);
      if (!summary) return fail(new Error(`${model} did not return a usable summary.`), 502);
      return Response.json({ model, task, text: summary });
    }

    if (task === "title") {
      const raw = await generate(
        model,
        `Write a better title for this wiki page.\n\n---\n${excerpt}\n---`,
        {
          system:
            "You title wiki pages. Reply with one title of at most eight words, in plain text. No preamble, no quotes, no trailing punctuation, no explanation.",
          timeoutMs: TIMEOUT_MS,
        },
      );
      const title = toTitle(raw);
      if (!title) return fail(new Error(`${model} did not return a usable title.`), 502);
      return Response.json({ model, task, text: title });
    }

    const existing = Array.isArray(body.existing)
      ? body.existing.filter((t): t is string => typeof t === "string").slice(0, MAX_EXISTING_TAGS)
      : [];
    const menu = existing.length
      ? `Prefer these tags that the wiki already uses, and only invent one when none of them fit:\n${existing.join(", ")}\n\n`
      : "";
    const raw = await generate(
      model,
      `${menu}Choose 3 to 6 tags for this wiki page.\n\n---\n${excerpt}\n---\n\nReply with a JSON array of lowercase strings and nothing else.`,
      {
        system:
          'You tag documents for a wiki. Reply with a JSON array of 3 to 6 lowercase tags and nothing else, for example ["billing","architecture"]. No preamble, no code fences, no explanation.',
        timeoutMs: TIMEOUT_MS,
      },
    );
    const tags = toTags(raw, existing);
    if (!tags) return fail(new Error(`${model} did not return usable tags.`), 502);
    return Response.json({ model, task, tags });
  } catch (error) {
    return fail(error, 502);
  }
}
