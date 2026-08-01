"use client";

import {
  renderAgentIndex,
  searchIndex,
  type WikiIndex,
  type WikiPage,
} from "@/lib/index-core";
import { hubs, triage, trustOf, type Ledger, type TriageEvent } from "@/lib/trust-core";
import { hashOf, readLedger, writeLedger } from "@/lib/browser-vault";
import {
  DEFAULT_POLICY,
  matches,
  type Policy,
} from "@/lib/policy-defaults";
import { renderHealth } from "@/lib/health-core";
import { buildBudget } from "@/lib/tokens";
import type { PageMeta, VaultIndex } from "@/lib/types";

/**
 * The vault UI, served from memory instead of from a server.
 *
 * Every screen in components/lore talks to the app the same way: `fetch("/api/…")`.
 * That is worth preserving rather than forking — two implementations of the same
 * screens is how the browser version quietly becomes a worse, stale copy of the
 * desktop one. So instead of rewriting the components to take a data source,
 * this installs a `fetch` that answers those same URLs from the index already in
 * memory. The components do not know they are in a browser vault, and there is
 * exactly one implementation of every screen.
 *
 * Anything genuinely unavailable here answers honestly with a 501 and a sentence
 * saying which part of the desktop app does it. A silent empty array would read
 * as "your wiki has none of these", which is a lie about the user's data — much
 * worse than a feature that says it is not here.
 */

type State = {
  index: WikiIndex;
  texts: Map<string, string>;
  name: string;
  /** The open folder, so Rescan can re-read it and Unlink can let it go. */
  handle: FileSystemDirectoryHandle;
  /** Re-read the folder and swap the state in. Supplied by the page. */
  rescan: () => Promise<void>;
  /** Drop the stored handle and return to the picker. */
  forget: () => Promise<void>;
};

let state: State | null = null;
let original: typeof fetch | null = null;

/** Hashes are recomputed on scan; trust is derived, never stored as a state. */
function hashes(index: WikiIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const page of index.pages) out.set(page.id, hashOf(page.plain));
  return out;
}

const toMeta = (page: WikiPage): PageMeta => {
  const { plain: _p, frontmatter: _f, rawLinks: _r, ...meta } = page;
  return meta;
};

function toVaultIndex(s: State): VaultIndex {
  return {
    root: s.name,
    name: s.name,
    pages: s.index.pages.map(toMeta),
    backlinks: s.index.backlinks,
    tags: s.index.tags,
    folders: s.index.folders,
    errors: s.index.errors,
    scannedAt: s.index.scannedAt,
  };
}

/**
 * What changed, without a watcher.
 *
 * The desktop app journals every write as it happens, so it knows a page lost
 * 31 lines. A browser tab that was handed a folder five seconds ago knows only
 * each file's modification time — so it can say WHICH pages changed recently and
 * rank them, but not by how much.
 *
 * Rather than invent line counts, every event reports zero and the ranking falls
 * back to reach and trust state, which triage already weighs. The UI says the
 * rest: a browser vault shows no diffs, and the card explains why.
 */
function eventsFromMtimes(index: WikiIndex, since: number): TriageEvent[] {
  return index.pages
    .filter((p) => p.mtime >= since)
    .map((p) => ({
      at: p.mtime,
      relPath: p.relPath,
      kind: "rewritten" as const,
      linesAdded: 0,
      linesRemoved: 0,
    }));
}

/**
 * The trust policy, per folder, in this browser.
 *
 * It used to be answered from the constant and thrown away on save, so every
 * control in that panel — the decay windows, the ageing window, the sign-off
 * stamp — silently reverted the moment you touched it. Storing it beside the
 * ledger keeps the two halves of "what do I trust" in the same place, and means
 * the settings survive a reload like they do on the desktop.
 */
const policyKey = (name: string) => `lore-web-policy:${name}`;

function readPolicy(name: string): Policy {
  try {
    const raw = localStorage.getItem(policyKey(name));
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as Partial<Policy>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_POLICY.rules,
      defaultDays: parsed.defaultDays ?? DEFAULT_POLICY.defaultDays,
      decayDays: parsed.decayDays ?? DEFAULT_POLICY.decayDays,
      quarantined: Array.isArray(parsed.quarantined) ? parsed.quarantined : [],
      protectedPaths: Array.isArray(parsed.protectedPaths) ? parsed.protectedPaths : [],
      quarantineFolders: Array.isArray(parsed.quarantineFolders) ? parsed.quarantineFolders : [],
      // No git in a browser tab, whatever is stored.
      autoCommit: false,
      // Never true here whatever is stored: stamping edits the markdown, and
      // this folder was opened read-only. See the PUT below.
      stampFrontmatter: false,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Routes the desktop app owns because they need a machine, not a tab. */
const ELSEWHERE: Record<string, string> = {
  "/api/ai": "Local AI models run through Ollama on your machine, which a web page cannot reach.",
  "/api/semantic": "Semantic search builds embeddings locally; the browser build ships the literal search only.",
  "/api/remote": "Phone access serves your wiki from your computer, so it needs the app running there.",
  "/api/agent": "Writing pages is a desktop feature. This tab has read-only access to your folder.",
  "/api/ingest": "Importing files writes into your wiki, which the browser build never does.",
  "/api/maintain": "Maintenance rewrites pages, which the browser build never does.",
  "/api/autolink": "Autolinking rewrites pages, which the browser build never does.",
  "/api/templates": "Templates create pages, which the browser build never does.",
  "/api/git": "Git needs a shell on your machine.",
  "/api/attachment": "Images inside your wiki are read by the desktop app; this tab does not serve files.",
  "/api/history":
    "Page history is recorded by the watcher that runs alongside the desktop app. A browser tab was not there when the change happened, so there is nothing to compare.",
  "/api/harness": "Which agent made a change is recorded by a hook on your machine.",
  "/api/usage": "Usage is measured by the local MCP server.",
  "/api/mcp": "The MCP server runs on your machine so your agents can reach it.",
};

async function handle(url: URL, init?: RequestInit): Promise<Response | null> {
  const s = state;
  if (!s || !url.pathname.startsWith("/api/")) return null;

  const p = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const params = url.searchParams;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  /*
   * Rescan means what it says. `?refresh=1` on the server re-walks the folder;
   * here it has to re-read the directory handle, or the button reports success
   * and shows the same index it showed before — the most quietly dishonest kind
   * of broken.
   */
  if (p === "/api/pages") {
    if (params.get("refresh") === "1") {
      await s.rescan();
      return json(toVaultIndex(state!));
    }
    return json(toVaultIndex(s));
  }

  if (p === "/api/vault") {
    // Unlink has to release the stored handle. Without this the page reloaded,
    // found the handle still in IndexedDB and reopened the same folder, so the
    // button looked like it did nothing at all.
    if (method === "POST" && body.action === "unlink") {
      await s.forget();
      return json({ ok: true });
    }
    if (method === "POST") {
      return json(
        {
          error:
            "Switching folders in the browser goes through your browser's own folder picker. Use Switch folder at the top of the window.",
          desktopOnly: true,
        },
        501,
      );
    }
    return json({
      vaults: [{ root: s.name, name: s.name, linkedAt: s.index.scannedAt }],
      activeVault: s.name,
      suggestions: [],
    });
  }

  /*
   * Read-only is not a setting here, it is the browser's answer.
   *
   * The desktop app enforces its own lock, which a determined bug could get
   * past. This tab asked for `mode: "read"` when it opened the folder, so the
   * platform refuses a write below us. Reporting it as locked-and-unchangeable
   * is the accurate description.
   */
  if (p === "/api/safety") {
    return json({ readOnly: true, changedAt: null, locked: true, blocks: [] });
  }

  if (p === "/api/policy") {
    const current = readPolicy(s.name);

    if (method === "PUT") {
      const next: Policy = {
        rules: ((body.rules as Policy["rules"]) ?? current.rules)
          .filter((r) => r.match?.trim() && Number.isFinite(r.days))
          .map((r) => ({ ...r, days: Math.max(1, Math.round(r.days)) })),
        defaultDays: Math.max(1, Math.round((body.defaultDays as number) ?? current.defaultDays)),
        decayDays: Math.max(1, Math.round((body.decayDays as number) ?? current.decayDays)),
        quarantined: (body.quarantined as string[]) ?? current.quarantined,
        protectedPaths:
          ((body.protectedPaths as string[]) ?? current.protectedPaths ?? []).filter(Boolean),
        quarantineFolders:
          ((body.quarantineFolders as string[]) ?? current.quarantineFolders ?? []).filter(Boolean),
        autoCommit: false,
        /*
         * Refused, not stored.
         *
         * Writing `lore_verified:` into a page edits the user's markdown, and
         * this folder was handed over with `mode: "read"` — the browser would
         * refuse the write even if we tried it. Accepting the tick and quietly
         * doing nothing would be the worst of the three options, so the setting
         * comes back off and the checkbox explains why.
         */
        stampFrontmatter: false,
      };
      localStorage.setItem(policyKey(s.name), JSON.stringify(next));
      return json({ ok: true, policy: next });
    }

    // Real coverage, computed the same way the server computes it. Reporting
    // zero for every rule made the panel look broken and made a rule that
    // matched nothing indistinguishable from one that matched everything.
    const counts = new Map<string, number>();
    let fallback = 0;
    for (const page of s.index.pages) {
      const rule = current.rules.find((r) => matches(r, page.id, page.title));
      if (rule) counts.set(rule.match, (counts.get(rule.match) ?? 0) + 1);
      else fallback += 1;
    }

    return json({
      policy: current,
      coverage: current.rules.map((r) => ({ match: r.match, pages: counts.get(r.match) ?? 0 })),
      fallbackPages: fallback,
      totalPages: s.index.pages.length,
    });
  }

  if (p === "/api/page") {
    /*
     * The folder was opened with `mode: "read"`, so a write is refused by the
     * browser before it reaches any code of ours. Saying so plainly matches
     * what the desktop app returns in read-only mode, which is what the
     * sidebar and the editor already know how to display.
     */
    if (method !== "GET") {
      return json(
        {
          error:
            "This tab has read-only access to your folder, so Lore cannot create or change pages here. The desktop app can.",
          readOnly: true,
        },
        403,
      );
    }
    const relPath = params.get("path");
    const page = s.index.pages.find((x) => x.relPath === relPath);
    if (!page) return json({ error: "Page is not in the vault index." }, 404);
    const ledger = readLedger(s.name);
    const backlinkIds = s.index.backlinks[page.id] ?? [];
    return json({
      trust: trustOf(ledger, page.id, hashOf(page.plain), Date.now(), readPolicy(s.name).decayDays),
      verifiedAt: ledger[page.id]?.at ?? null,
      page: toMeta(page),
      frontmatter: page.frontmatter,
      raw: s.texts.get(page.relPath) ?? "",
      backlinks: s.index.pages.filter((x) => backlinkIds.includes(x.id)).map(toMeta),
      outgoing: s.index.pages.filter((x) => page.links.includes(x.id)).map(toMeta),
    });
  }

  /*
   * A folder as one document — the main reading surface, and the one endpoint
   * whose absence made the browser vault look broken rather than reduced: the
   * sidebar listed the folders and the document pane said "could not open".
   *
   * Paged the same way the server pages it, newest-edited first, because the
   * reason for paging is the browser's, not the server's: one measured vault
   * keeps 654 pages in a single folder.
   */
  if (p === "/api/folder") {
    const folder = params.get("path") ?? "";
    const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 40) || 40));

    const inFolder = s.index.pages
      .filter((page) => page.folder === folder)
      .sort((a, b) => b.mtime - a.mtime);
    const slice = inFolder.slice(offset, offset + limit);

    return json({
      folder,
      sections: slice.map((page) => ({
        page: toMeta(page),
        raw: s.texts.get(page.relPath) ?? "",
      })),
      total: inFolder.length,
      offset,
      limit,
      hasMore: offset + slice.length < inFolder.length,
    });
  }

  if (p === "/api/search") {
    const q = params.get("q") ?? "";
    return json({
      results: searchIndex(s.index, q, 40).map((hit) => ({
        page: toMeta(hit.page),
        score: hit.score,
        snippet: hit.snippet,
      })),
    });
  }

  if (p === "/api/health") return json(renderHealth(s.index));

  /*
   * Context budget. Derived entirely from the index, so the browser can answer
   * it exactly as the server does — and it is half of what Insights shows.
   * Leaving it to 501 left that whole screen spinning forever, which is a worse
   * failure than a missing feature: nothing on it ever said what was wrong.
   */
  if (p === "/api/budget") {
    return json(
      buildBudget(
        s.index.pages.map((page) => ({
          id: page.id,
          title: page.title,
          folder: page.folder,
          text: page.plain,
        })),
        renderAgentIndex(s.index, s.name),
      ),
    );
  }

  if (p === "/api/review") {
    const ledger = readLedger(s.name);
    const h = hashes(s.index);

    if (method === "POST") {
      const pageId = String(body.pageId ?? "");
      const next: Ledger = { ...ledger };
      if (body.action === "unverify") delete next[pageId];
      else {
        const hash = h.get(pageId);
        if (!hash) return json({ error: "That page is not in the vault." }, 404);
        next[pageId] = { hash, at: Date.now(), by: "me", note: String(body.note ?? "") };
      }
      writeLedger(s.name, next);
      return json({ ok: true, trust: body.action === "unverify" ? "unverified" : "verified" });
    }

    const days = Number(params.get("days") ?? 7);
    const since = Date.now() - days * 86_400_000;
    const pageMap = new Map(
      s.index.pages.map((x) => [x.id, { id: x.id, title: x.title, relPath: x.relPath }]),
    );
    const counts = { verified: 0, lapsed: 0, aging: 0, unverified: 0 };
    const decayDays = readPolicy(s.name).decayDays;
    for (const page of s.index.pages) {
      counts[trustOf(ledger, page.id, h.get(page.id) ?? "", Date.now(), decayDays)] += 1;
    }

    const events = eventsFromMtimes(s.index, since);
    return json({
      watching: false,
      browser: true,
      days,
      events: events.length,
      counts,
      triage: triage(events, pageMap, s.index.backlinks, ledger, h).map((item) => ({
        ...item,
        agent: null,
        quarantined: false,
      })),
      hubs: hubs(s.index.backlinks, pageMap, ledger, h),
      forecast: [],
      quarantined: [],
      attributed: 0,
    });
  }

  const reason = Object.entries(ELSEWHERE).find(([route]) => p === route || p.startsWith(`${route}/`));
  if (reason) return json({ error: reason[1], desktopOnly: true }, 501);

  return json({ error: `${p} is not available in the browser build.`, desktopOnly: true }, 501);
}

/**
 * Take over `/api/*` for this tab. Idempotent; call again to swap the vault.
 *
 * Only same-origin `/api/` paths are intercepted — everything else, including
 * Next's own chunk loading, goes straight through to the real fetch.
 */
export function installBrowserApi(next: State): void {
  state = next;
  if (original) return;

  original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      return original!(input, init);
    }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return original!(input, init);
    }
    // Callers in this app always pass method and body through `init`; a Request
    // object is never constructed. If one ever is, it falls through to the real
    // fetch and 404s loudly rather than being silently answered with a GET.
    if (typeof input === "object" && !(input instanceof URL)) return original!(input, init);
    const response = await handle(url, init);
    return response ?? original!(input, init);
  };
}

export function uninstallBrowserApi(): void {
  if (original) globalThis.fetch = original;
  original = null;
  state = null;
}
