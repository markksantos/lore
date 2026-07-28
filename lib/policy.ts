import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";
import type { Ledger, TrustState } from "@/lib/verify";

/**
 * Per-vault trust policy: how long facts stay true, and which pages agents are
 * not allowed to read yet.
 *
 * The staleness windows used to live in a constant in `lib/wiki.ts`, which
 * assumed every page decays at the same rate. Nothing does. A pricing page is
 * wrong within a month; a note on why you chose Postgres is still true in three
 * years. Getting this wrong in either direction is expensive — too short and
 * the review queue is noise you learn to dismiss, too long and the wiki lies
 * with a straight face.
 *
 * So the windows are data, editable, and matched by path or title.
 */

const DIR = path.join(os.homedir(), ".lore");
const policyPath = (key: string) => path.join(DIR, `policy-${key}.json`);

export type Rule = {
  /** Case-insensitive substring or /regex/ tested against the page id and title. */
  match: string;
  days: number;
  label?: string;
};

export type Policy = {
  /** First matching rule wins, so order is meaningful. */
  rules: Rule[];
  defaultDays: number;
  /** How long a verification stays fresh before it is called aging. */
  decayDays: number;
  /**
   * Pages withheld from every agent-facing surface until a human clears them.
   *
   * This is not the approval gate coming back. The gate tried to stop agents
   * writing, which is unenforceable. This stops Lore *serving* a page it already
   * knows is wrong — entirely within its power, because handing pages out is the
   * one thing it does control.
   */
  quarantined: string[];
  /**
   * Mirror a sign-off into the page's own frontmatter as `lore_verified`.
   *
   * Off by default, and it should stay off for most people: the ledger lives
   * outside the vault precisely so that verifying a page leaves the file
   * byte-identical and `git status` stays clean.
   *
   * It exists because Obsidian users asked for it, and their reason is good.
   * Dataview can only query fields that are in the file, so without a stamp
   * there is no way to write `WHERE lore_verified` and get a table of what has
   * been checked — the trust data is real but invisible to the tool they
   * actually read their wiki in. Anyone who turns this on is choosing a noisier
   * diff in exchange for a queryable field, which is a trade only they can make.
   */
  stampFrontmatter: boolean;
};

export const DEFAULT_POLICY: Policy = {
  // The measured defaults, carried over verbatim from the constant these
  // replace, so an existing vault behaves identically until someone edits them.
  rules: [
    { match: "/pricing|cost|rate|invoice/", days: 30, label: "Money moves" },
    { match: "/client|project|status|roadmap/", days: 60, label: "Work in flight" },
    { match: "/tool|stack|version|setup|install|config/", days: 90, label: "Tooling drifts" },
  ],
  defaultDays: 180,
  decayDays: 120,
  quarantined: [],
  stampFrontmatter: false,
};

export async function readPolicy(root: string): Promise<Policy> {
  const raw = await fs.readFile(policyPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return DEFAULT_POLICY;
  try {
    const parsed = JSON.parse(raw) as Partial<Policy>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_POLICY.rules,
      defaultDays: parsed.defaultDays ?? DEFAULT_POLICY.defaultDays,
      decayDays: parsed.decayDays ?? DEFAULT_POLICY.decayDays,
      quarantined: Array.isArray(parsed.quarantined) ? parsed.quarantined : [],
      stampFrontmatter: parsed.stampFrontmatter === true,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function writePolicy(root: string, policy: Policy): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(policyPath(vaultKey(root)), JSON.stringify(policy, null, 2), "utf8");
}

function matches(rule: Rule, id: string, title: string): boolean {
  const raw = rule.match.trim();
  if (!raw) return false;
  const hay = `${id} ${title}`.toLowerCase();

  if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
    // A rule the user wrote as /.../ is a regex; a broken one must not take the
    // whole report down with it.
    const body = raw.slice(1, raw.lastIndexOf("/"));
    const flags = raw.slice(raw.lastIndexOf("/") + 1);
    try {
      return new RegExp(body, flags.includes("i") ? flags : flags + "i").test(hay);
    } catch {
      return false;
    }
  }
  return hay.includes(raw.toLowerCase());
}

/** The review window for one page, and which rule decided it. */
export function windowFor(
  policy: Policy,
  id: string,
  title: string,
): { days: number; rule?: Rule } {
  const rule = policy.rules.find((r) => matches(r, id, title));
  return { days: rule?.days ?? policy.defaultDays, rule };
}

export const isQuarantined = (policy: Policy, pageId: string) =>
  policy.quarantined.includes(pageId);

// ---------------------------------------------------------------- forecasting

export type Expiry = {
  pageId: string;
  title: string;
  /** Days until this verification is called aging. Negative means already. */
  inDays: number;
  verifiedAt: number;
};

/**
 * What lapses next.
 *
 * Verification is otherwise a thing you only discover has expired by opening
 * Review and finding a pile. A forecast turns it into a schedule: this month you
 * owe eleven pages, and here they are.
 */
export function forecast(
  ledger: Ledger,
  pages: { id: string; title: string }[],
  policy: Policy,
  withinDays = 60,
  now = Date.now(),
): Expiry[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: Expiry[] = [];

  for (const [pageId, v] of Object.entries(ledger)) {
    const page = byId.get(pageId);
    if (!page) continue;
    const ageDays = (now - v.at) / 86_400_000;
    const inDays = Math.round(policy.decayDays - ageDays);
    if (inDays <= withinDays) {
      out.push({ pageId, title: page.title, inDays, verifiedAt: v.at });
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

/** Trust states grouped into the buckets a human plans around. */
export function trustSummary(states: TrustState[]) {
  const counts = { verified: 0, aging: 0, lapsed: 0, unverified: 0 };
  for (const s of states) counts[s] += 1;
  const total = states.length || 1;
  return { ...counts, checkedPct: Math.round((counts.verified / total) * 100) };
}
