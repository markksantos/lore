import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey, type WriteEvent } from "@/lib/journal";

/**
 * The verification ledger — the primitive the corpus is missing.
 *
 * Measured on a real vault: 1,156 pages carry an agent-written `confidence:`
 * field. 959 say "high", 202 "medium", 2 say "low". Agents grade their own
 * homework and essentially always pass, so that field carries no information.
 *
 * Meanwhile **zero** pages carry any human `reviewed` or `verified` field. The
 * corpus records machine writes and never once records a human confirmation.
 * Every page therefore looks identically trustworthy, whether you checked it
 * personally or an agent invented it at 3am.
 *
 * This is promotion, not permission. Agents write freely — they already do, and
 * nothing local can stop them. Everything lands `unverified`. A human promotes
 * what they have actually checked, and the promotion is pinned to the content
 * hash, so the moment an agent rewrites a verified page the verification lapses
 * automatically. Trust that cannot lapse is not trust, it is a sticker.
 *
 * The ledger lives outside the vault so it never pollutes a `git diff`. It is
 * the only copy: nothing is mirrored into frontmatter, so the vault's files are
 * byte-identical whether or not a page has been verified.
 */

const DIR = path.join(os.homedir(), ".lore");
const ledgerPath = (key: string) => path.join(DIR, `verified-${key}.json`);

export type Verification = {
  /** Content hash at the moment a human confirmed it. */
  hash: string;
  at: number;
  by: string;
  note?: string;
};

export type Ledger = Record<string, Verification>;

/** How long a verification stays fresh before it starts to decay. */
const DECAY_DAYS = 120;

export type TrustState =
  | "verified"
  /** Confirmed once, but the page has been rewritten since. */
  | "lapsed"
  /** Confirmed long enough ago that it deserves another look. */
  | "aging"
  | "unverified";

export async function readLedger(root: string): Promise<Ledger> {
  const raw = await fs.readFile(ledgerPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Ledger;
  } catch {
    return {};
  }
}

export async function writeLedger(root: string, ledger: Ledger): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(ledgerPath(vaultKey(root)), JSON.stringify(ledger, null, 2), "utf8");
}

export async function verifyPage(
  root: string,
  pageId: string,
  hash: string,
  by = "me",
  note?: string,
): Promise<Ledger> {
  const ledger = await readLedger(root);
  ledger[pageId] = { hash, at: Date.now(), by, note };
  await writeLedger(root, ledger);
  return ledger;
}

export async function unverifyPage(root: string, pageId: string): Promise<Ledger> {
  const ledger = await readLedger(root);
  delete ledger[pageId];
  await writeLedger(root, ledger);
  return ledger;
}

export function trustOf(
  ledger: Ledger,
  pageId: string,
  currentHash: string,
  now = Date.now(),
): TrustState {
  const v = ledger[pageId];
  if (!v) return "unverified";
  if (v.hash !== currentHash) return "lapsed";
  if (now - v.at > DECAY_DAYS * 86_400_000) return "aging";
  return "verified";
}

// -------------------------------------------------------------------- triage

export type TriageItem = {
  pageId: string;
  relPath: string;
  title: string;
  trust: TrustState;
  /** Pages that link here. High values mean a wrong edit propagates widely. */
  inbound: number;
  linesRemoved: number;
  linesAdded: number;
  kind: WriteEvent["kind"];
  at: number;
  score: number;
  /** Plain-English reason this made the list, shown to the user. */
  why: string;
};

/**
 * Rank the week's changes so a human reviews five things instead of three
 * hundred.
 *
 * The weighting encodes what actually goes wrong, measured rather than guessed:
 *
 *  - DELETION is the risk. Agents rewrite in place far more than they append,
 *    and deleted prose is the only truly unrecoverable outcome. Weighted highest.
 *  - BLAST RADIUS is concentrated. A handful of hub pages absorb a large share
 *    of all inbound links, so a bad edit to one propagates into every answer
 *    that walks the graph. Inbound count is dampened with a log — the difference
 *    between 2 and 20 inbound links matters far more than 200 versus 400.
 *  - LAPSED beats UNVERIFIED. A page you once checked and an agent has since
 *    rewritten is more alarming than one you never checked at all, because you
 *    are carrying a belief about it that may no longer hold.
 *
 * Pure additions to pages nobody links to score near zero, which is correct:
 * that is the bulk of the 300 weekly changes and none of it needs you.
 */
export function triage(
  events: WriteEvent[],
  pages: Map<string, { id: string; title: string; relPath: string }>,
  backlinks: Record<string, string[]>,
  ledger: Ledger,
  hashes: Map<string, string>,
  limit = 12,
): TriageItem[] {
  /** Collapse repeated writes to the same page into its most severe edit. */
  const latest = new Map<string, WriteEvent>();
  for (const e of events) {
    const prev = latest.get(e.relPath);
    if (!prev || e.linesRemoved > prev.linesRemoved || e.at > prev.at) {
      latest.set(e.relPath, {
        ...e,
        linesRemoved: Math.max(e.linesRemoved, prev?.linesRemoved ?? 0),
        linesAdded: Math.max(e.linesAdded, prev?.linesAdded ?? 0),
      });
    }
  }

  const items: TriageItem[] = [];

  for (const [relPath, e] of latest) {
    const pageId = relPath.replace(/\.mdx?$/i, "");
    const page = pages.get(pageId);
    if (!page) continue;

    const inbound = backlinks[pageId]?.length ?? 0;
    const trust = trustOf(ledger, pageId, hashes.get(pageId) ?? "");

    const deletionWeight = e.linesRemoved * 3;
    const additionWeight = e.linesAdded * 0.2;
    const reachWeight = Math.log2(inbound + 1) * 8;
    const trustWeight = trust === "lapsed" ? 25 : trust === "unverified" ? 10 : 0;
    const rewritePenalty = e.kind === "rewritten" ? 12 : 0;

    const score =
      deletionWeight + additionWeight + reachWeight + trustWeight + rewritePenalty;

    const reasons: string[] = [];
    if (e.linesRemoved > 0) reasons.push(`${e.linesRemoved} lines removed`);
    if (inbound >= 5) reasons.push(`${inbound} pages link here`);
    if (trust === "lapsed") reasons.push("you had verified this");
    if (e.kind === "rewritten" && !reasons.length) reasons.push("rewritten in place");
    if (!reasons.length) reasons.push(`${e.linesAdded} lines added`);

    items.push({
      pageId,
      relPath,
      title: page.title,
      trust,
      inbound,
      linesRemoved: e.linesRemoved,
      linesAdded: e.linesAdded,
      kind: e.kind,
      at: e.at,
      score: Math.round(score),
      why: reasons.join(" · "),
    });
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The hub pages — where an unverified rewrite does the most damage. Surfaced on
 * its own because these deserve verification as a standing policy, not only
 * when something happens to touch them.
 */
export function hubs(
  backlinks: Record<string, string[]>,
  pages: Map<string, { id: string; title: string; relPath: string }>,
  ledger: Ledger,
  hashes: Map<string, string>,
  limit = 10,
): { pageId: string; title: string; inbound: number; trust: TrustState }[] {
  return Object.entries(backlinks)
    .map(([pageId, from]) => ({
      pageId,
      title: pages.get(pageId)?.title ?? pageId,
      inbound: from.length,
      trust: trustOf(ledger, pageId, hashes.get(pageId) ?? ""),
    }))
    .filter((h) => pages.has(h.pageId))
    .sort((a, b) => b.inbound - a.inbound)
    .slice(0, limit);
}
