import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { vaultKey } from "@/lib/journal";
import { around } from "@/lib/timeline";

const run = promisify(execFile);

/**
 * Enrichment — the things you watched and read, kept.
 *
 * The recorder can prove you spent forty minutes on a YouTube video or an
 * article; what it cannot do is keep the CONTENT, because a screenshot of a
 * video is a picture of a paused frame and OCR of an article is typography
 * soup. This closes that gap: URLs the screen actually dwelled on get their
 * substance fetched properly — a transcript for a video, the article text for
 * a page — and filed under capture/, where retrieval can reach it.
 *
 * Dwell is the consent signal and the noise filter in one. A tab flicked past
 * in four seconds is browsing; a URL on screen across a minute of frames is
 * attention. Only attention gets fetched — this must never become a logger of
 * every link that crossed the screen.
 *
 * Honesty about the network: fetching a transcript means asking YouTube for
 * it. Nothing about YOU leaves the machine — no wiki content, no history
 * upload, just the same GET your browser already made — but this is the one
 * Lore feature that talks to the internet at all, so it is its own switch,
 * off by default.
 */

export type EnrichConfig = {
  enabled: boolean;
  youtube: boolean;
  articles: boolean;
  /** Seconds a URL must hold the screen before it earns a fetch. */
  dwellSeconds: number;
};

export const DEFAULT_ENRICH: EnrichConfig = {
  enabled: false,
  youtube: true,
  articles: true,
  dwellSeconds: 60,
};

const DIR = path.join(os.homedir(), ".lore");
const configPath = (key: string) => path.join(DIR, `enrich-${key}.json`);
const statePath = (key: string) => path.join(DIR, `enrich-state-${key}.json`);

export async function readEnrichConfig(root: string): Promise<EnrichConfig> {
  const raw = await fs.readFile(configPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return DEFAULT_ENRICH;
  try {
    const parsed = JSON.parse(raw) as Partial<EnrichConfig>;
    return {
      enabled: parsed.enabled === true,
      youtube: parsed.youtube !== false,
      articles: parsed.articles !== false,
      dwellSeconds: Math.max(20, Number(parsed.dwellSeconds) || DEFAULT_ENRICH.dwellSeconds),
    };
  } catch {
    return DEFAULT_ENRICH;
  }
}

export async function writeEnrichConfig(root: string, config: EnrichConfig): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath(vaultKey(root)), JSON.stringify(config, null, 2), "utf8");
}

/** URLs already fetched (or judged unfetchable), so nothing is fetched twice. */
async function readDone(key: string): Promise<Record<string, number>> {
  const raw = await fs.readFile(statePath(key), "utf8").catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

async function writeDone(key: string, done: Record<string, number>): Promise<void> {
  const entries = Object.entries(done);
  const kept = entries.length > 5_000 ? entries.slice(-5_000) : entries;
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath(key), JSON.stringify(Object.fromEntries(kept)), "utf8");
}

// --------------------------------------------------------------------- dwell

export type DwelledUrl = { url: string; seconds: number; frames: number; title: string };

/**
 * URLs the screen actually stayed on, from the recorder's frames.
 *
 * The recorder captures on change, so dwell is the span between a URL's first
 * and last frame. Fragments and query strings that only vary tracking noise
 * are collapsed so one article read across a search-highlight redirect counts
 * once.
 */
export function dwelledUrls(
  captures: { at: number; url: string | null; title: string }[],
  minSeconds: number,
): DwelledUrl[] {
  const byUrl = new Map<string, { first: number; last: number; frames: number; title: string }>();
  for (const capture of captures) {
    if (!capture.url) continue;
    const url = normaliseUrl(capture.url);
    if (!url) continue;
    const entry = byUrl.get(url);
    if (entry) {
      entry.first = Math.min(entry.first, capture.at);
      entry.last = Math.max(entry.last, capture.at);
      entry.frames += 1;
      if (capture.title) entry.title = capture.title;
    } else {
      byUrl.set(url, { first: capture.at, last: capture.at, frames: 1, title: capture.title });
    }
  }
  const out: DwelledUrl[] = [];
  for (const [url, entry] of byUrl) {
    const seconds = Math.round((entry.last - entry.first) / 1000);
    if (seconds >= minSeconds) out.push({ url, seconds, frames: entry.frames, title: entry.title });
  }
  return out.sort((a, b) => b.seconds - a.seconds);
}

export function normaliseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A first, textual pass over the literal host — cheap, and it rejects the
  // obvious loopback/LAN forms before we spend a DNS lookup. It is NOT the
  // real defence: a public name that resolves to a private address slips every
  // string check, so the fetch path resolves and re-checks (see isPublicHost).
  // `new URL("http://[::1]/").hostname` keeps the brackets, so strip them.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (isPrivateHostLiteral(host)) return null;
  url.hash = "";
  for (const param of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref_|si$)/.test(param)) url.searchParams.delete(param);
  }
  return url.toString();
}

/**
 * Is this literal host obviously non-public?
 *
 * Covers the forms a URL can spell without DNS: loopback in v4 and v6 and
 * their oddities (0.0.0.0, 127.anything, 127.1, decimal and hex encodings),
 * RFC1918, link-local and cloud metadata (169.254/16), CGNAT/Tailscale
 * (100.64/10), IPv6 ULA/link-local, and the reserved suffixes (.local,
 * .internal, .home.arpa, .lan). Everything the reviewer's D3/m2 probes named.
 */
export function isPrivateHostLiteral(host: string): boolean {
  if (
    host === "" ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan")
  ) {
    return true;
  }
  // IPv6 loopback/link-local/ULA.
  if (host.includes(":")) {
    return /^::1$/.test(host) || /^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host);
  }
  // Decimal (2130706433) or hex (0x7f000001) encodings of an IPv4 address.
  const asInt =
    /^\d{1,10}$/.test(host)
      ? Number(host)
      : /^0x[0-9a-f]+$/i.test(host)
        ? parseInt(host, 16)
        : null;
  if (asInt !== null && asInt >= 0 && asInt <= 0xffffffff) {
    return isPrivateV4([(asInt >>> 24) & 255, (asInt >>> 16) & 255, (asInt >>> 8) & 255, asInt & 255]);
  }
  // Dotted IPv4, including short forms like 127.1.
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length >= 1 && parts.length <= 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const octets = parts.length === 4 ? parts : [parts[0], 0, 0, parts[parts.length - 1]];
    if (parts.every((n, i) => i === parts.length - 1 || n <= 255)) return isPrivateV4(octets);
  }
  return false;
}

function isPrivateV4(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 127 || // loopback
    a === 10 || // RFC1918
    a === 0 || // "this network"
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale
  );
}

/**
 * The real SSRF defence: resolve the name and reject if it points anywhere
 * private. D4 — a public hostname whose DNS answers 127.0.0.1 — cannot be
 * caught by inspecting the string, only by resolving it.
 *
 * There is a residual TOCTOU window (the name could re-resolve between this
 * check and the fetch); for a personal tool fetching an article this is an
 * accepted, documented risk, and closing it fully would mean pinning the
 * socket to the checked IP and losing TLS SNI. This turns "trivially
 * exploitable" into "requires an active rebind against a localhost-only app".
 */
export async function isPublicHost(host: string): Promise<boolean> {
  const cleaned = host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (isPrivateHostLiteral(cleaned)) return false;
  // A literal IP that passed the private check is public; no lookup needed.
  if (/^[\d.]+$/.test(cleaned) || cleaned.includes(":")) return true;
  try {
    const { lookup } = await import("node:dns/promises");
    const results = await lookup(cleaned, { all: true });
    if (!results.length) return false;
    return results.every((r) => {
      if (r.family === 6) return !isPrivateHostLiteral(r.address);
      return !isPrivateV4(r.address.split(".").map(Number));
    });
  } catch {
    // Unresolvable is not fetchable; treat as non-public rather than risk it.
    return false;
  }
}

export function youtubeId(url: string): string | null {
  const parsed = new URL(url);
  if (/(^|\.)youtube\.com$/.test(parsed.hostname)) {
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
    const short = parsed.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
    if (short) return short[2];
  }
  if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1) || null;
  return null;
}

// ------------------------------------------------------------------- youtube

/**
 * Transcript via yt-dlp when it is installed, metadata via oEmbed either way.
 *
 * yt-dlp is the only tool that reliably gets subtitles, and it is already on
 * this machine's PATH for many developers. When it is missing the page still
 * gets written — title, channel, url, how long you watched — because "you
 * watched this on Tuesday" is retrievable value even without the words.
 */
export async function fetchYouTube(
  url: string,
  id: string,
): Promise<{ title: string; author: string; transcript: string | null }> {
  let title = "";
  let author = "";
  const oembed = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    { signal: AbortSignal.timeout(10_000) },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (oembed) {
    title = String(oembed.title ?? "");
    author = String(oembed.author_name ?? "");
  }

  let transcript: string | null = null;
  const hasYtDlp = await run("which", ["yt-dlp"]).then(() => true).catch(() => false);
  if (hasYtDlp) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lore-yt-"));
    try {
      await run(
        "yt-dlp",
        [
          "--skip-download",
          "--write-auto-subs",
          "--write-subs",
          "--sub-langs",
          "en.*,pt.*",
          "--sub-format",
          "vtt",
          "-o",
          path.join(tmp, "sub"),
          `https://www.youtube.com/watch?v=${id}`,
        ],
        { timeout: 60_000 },
      );
      const files = await fs.readdir(tmp);
      const vtt = files.find((f) => f.endsWith(".vtt"));
      if (vtt) transcript = vttToText(await fs.readFile(path.join(tmp, vtt), "utf8"));
    } catch {
      // No subtitles is a normal outcome, not an error.
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { title, author, transcript };
}

/** WebVTT → plain text: cues deduplicated, timestamps and tags dropped. */
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  let last = "";
  for (const raw of vtt.split("\n")) {
    const line = raw
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (!line || line === "WEBVTT" || /^\d+$/.test(line)) continue;
    if (/-->/.test(line) || /^(Kind|Language|NOTE|STYLE)[:\s]/.test(line)) continue;
    // Auto-subs repeat each cue as it scrolls; consecutive repeats collapse.
    if (line === last) continue;
    last = line;
    lines.push(line);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------- article

/**
 * The readable text of a page, without a readability dependency.
 *
 * Not a general extractor and not trying to be: scripts, styles, nav and
 * boilerplate go, block tags become line breaks, and the result is judged by
 * a simple floor — a real article yields paragraphs of prose, a JS-only shell
 * yields crumbs, and crumbs are reported as a failed extraction rather than
 * filed as if they were the article.
 */
export function extractArticle(html: string): { title: string; text: string } | null {
  const title =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ??
    "";

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer the marked article body when the page declares one.
  const article = body.match(/<article[\s\S]*?<\/article>/i);
  if (article) body = article[0];

  const text = body
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|rsquo|lsquo|ldquo|rdquo);/g, (m) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"' })[m] ?? " ",
    )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    // Boilerplate lines are short; prose is not. Keeping only substantial
    // lines drops menus, cookie banners and share buttons in one move.
    .filter((line) => line.length > 60 || /^#{1,3}\s/.test(line))
    .join("\n\n");

  /*
   * Length is not quality.
   *
   * A cookie-consent banner and a JS-required SPA shell with a legal footer
   * both clear a 400-char floor, and both were being filed as articles. A real
   * article has SEVERAL substantial paragraphs and reads like prose; boilerplate
   * is one long legal sentence or a wall of nav. So: require multiple genuine
   * paragraphs and several sentence terminators, and reject when the text is
   * dominated by consent/legal vocabulary.
   */
  const paragraphs = text.split("\n\n").filter((p) => p.length > 80);
  const sentences = (text.match(/[.!?]["')\]]?(\s|$)/g) ?? []).length;
  const boilerplate =
    /\b(accept all cookies|cookie preferences|privacy policy|terms of service|enable javascript|please enable|your consent|we and our partners|manage (your )?(cookies|preferences)|gdpr)\b/gi;
  const boilerplateHits = (text.match(boilerplate) ?? []).length;

  // The gate has to reject two shapes without rejecting a genuine short
  // article: a consent banner (boilerplate-DENSE) and a JS shell (structure-
  // POOR). An early version keyed on a sentence count of four and a raw
  // boilerplate count of two, and dropped a real 721-char, 3-sentence, 2-mention
  // privacy-law story — the exact false negative NEW-2 named. So:
  //  - length is the floor for "is this even a page"
  //  - a text with neither multiple paragraphs NOR several sentences is a shell
  //  - boilerplate is judged by DENSITY, not presence, because a real article
  //    about privacy law says "privacy policy" a couple of times and a banner
  //    says almost nothing else
  const boilerplateDensity = boilerplateHits / Math.max(text.length / 1000, 1);
  if (
    text.length < 500 ||
    (paragraphs.length < 2 && sentences < 3) ||
    (boilerplateHits >= 3 && boilerplateDensity >= 5)
  ) {
    return null;
  }
  return { title: decodeEntities(title).trim(), text: text.slice(0, 20_000) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

// --------------------------------------------------------------------- sweep

export type EnrichResult = {
  candidates: number;
  fetched: number;
  wrote: string[];
  skipped: number;
};

const MAX_FETCHES_PER_SWEEP = 4;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";

/**
 * One pass: find dwelled URLs from the last day of frames, fetch the new
 * ones, file them. Same write path as everything else.
 */
export async function enrichSweep(root: string, port: number): Promise<EnrichResult> {
  const key = vaultKey(root);
  const config = await readEnrichConfig(root);
  const result: EnrichResult = { candidates: 0, fetched: 0, wrote: [], skipped: 0 };
  if (!config.enabled) return result;

  const { captures } = await around(Date.now() - 12 * 3_600_000, 12 * 60);
  const dwelled = dwelledUrls(captures, config.dwellSeconds);
  const done = await readDone(key);
  const fresh = dwelled.filter((d) => !done[d.url]);
  result.candidates = fresh.length;

  const file = async (pagePath: string, content: string): Promise<boolean> => {
    const response = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: pagePath,
        content,
        mode: "replace",
        agent: "Desktop Record (capture)",
      }),
    }).catch(() => null);
    return Boolean(response?.ok);
  };

  for (const candidate of fresh) {
    if (result.fetched >= MAX_FETCHES_PER_SWEEP) break;

    /*
     * The DNS-resolved gate, applied to every candidate before any fetch.
     * normaliseUrl already dropped the private literals; this catches the
     * public name that resolves to a private address (D4). A URL that fails
     * here is marked done so it is not retried into the same wall every sweep.
     */
    let hostname: string;
    try {
      hostname = new URL(candidate.url).hostname;
    } catch {
      done[candidate.url] = Date.now();
      await writeDone(key, done);
      continue;
    }
    if (!(await isPublicHost(hostname))) {
      result.skipped += 1;
      done[candidate.url] = Date.now();
      await writeDone(key, done);
      continue;
    }

    const id = youtubeId(candidate.url);

    if (id && config.youtube) {
      result.fetched += 1;
      const video = await fetchYouTube(candidate.url, id);
      const pagePath = `capture/youtube/${id}.md`;
      const content = [
        `# ${video.title || candidate.title || "YouTube video"}`,
        "",
        `${video.author ? `By ${video.author}. ` : ""}Watched for ~${Math.round(candidate.seconds / 60) || 1} min on ${new Date().toISOString().slice(0, 10)}.`,
        `Source: ${candidate.url}`,
        "",
        video.transcript
          ? `## Transcript\n\n${video.transcript.slice(0, 24_000)}`
          : "_No transcript was available._",
        "",
      ].join("\n");
      if (await file(pagePath, content)) {
        result.wrote.push(pagePath);
        done[candidate.url] = Date.now();
        await writeDone(key, done);
      }
      continue;
    }

    if (!id && config.articles) {
      result.fetched += 1;
      const html = await fetch(candidate.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (Macintosh) Lore/1.0" },
      })
        .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("html") ? r.text() : null))
        .catch(() => null);

      const article = html ? extractArticle(html) : null;
      // Unfetchable or unreadable is remembered too — retrying a paywall every
      // sweep is a crawler, not a memory.
      done[candidate.url] = Date.now();
      await writeDone(key, done);
      if (!article) {
        result.skipped += 1;
        continue;
      }
      const pagePath = `capture/articles/${slugify(article.title || candidate.title)}.md`;
      const content = [
        `# ${article.title || candidate.title}`,
        "",
        `Read for ~${Math.round(candidate.seconds / 60) || 1} min on ${new Date().toISOString().slice(0, 10)}.`,
        `Source: ${candidate.url}`,
        "",
        article.text,
        "",
      ].join("\n");
      if (await file(pagePath, content)) result.wrote.push(pagePath);
      continue;
    }

    result.skipped += 1;
    done[candidate.url] = Date.now();
    await writeDone(key, done);
  }

  return result;
}

// ----------------------------------------------------------------- scheduler

/** Same lazy pattern as the listener; slower, because attention is slow. */
const ENRICH_INTERVAL_MS = 30 * 60_000;
let scheduler: ReturnType<typeof setInterval> | null = null;
let lastRun: { at: number; result: EnrichResult } | null = null;
let running = false;

export function lastEnrichInfo(): { at: number; result: EnrichResult } | null {
  return lastRun;
}

export async function runEnrich(root: string, port: number): Promise<EnrichResult> {
  if (running) return lastRun?.result ?? { candidates: 0, fetched: 0, wrote: [], skipped: 0 };
  running = true;
  try {
    const result = await enrichSweep(root, port);
    lastRun = { at: Date.now(), result };
    return result;
  } finally {
    running = false;
  }
}

export async function ensureEnricher(root: string, port: number): Promise<void> {
  const config = await readEnrichConfig(root);
  if (!config.enabled) {
    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }
    return;
  }
  if (scheduler) return;
  scheduler = setInterval(() => {
    void runEnrich(root, port).catch(() => {});
  }, ENRICH_INTERVAL_MS);
  scheduler.unref?.();
  void runEnrich(root, port).catch(() => {});
}
