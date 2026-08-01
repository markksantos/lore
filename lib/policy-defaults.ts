/**
 * The policy shape and its defaults, with no filesystem attached.
 *
 * Split out so the browser build can render the same panel and describe the
 * same rules. lib/policy.ts adds reading and writing it to ~/.lore.
 */

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
  /**
   * Folders where an agent write is an event rather than a line in a log.
   *
   * A wiki holds things that are merely private and things that are
   * radioactive, and the difference is not visible to a tool that treats every
   * page as a page. A write into `raw/finance/` should be noticed the day it
   * happens; a write into `notes/` should not.
   *
   * Matched as path prefixes. Empty by default, because guessing which of
   * somebody's folders are sensitive is how you produce alerts they learn to
   * dismiss.
   */
  protectedPaths: string[];
  /**
   * Folders whose new pages are held back from agents until promoted.
   *
   * Quarantine already existed per page, applied after a human read something
   * wrong. This is the same idea one step earlier: a landing area agents can
   * write into freely, which does not become part of what the wiki tells
   * anyone until somebody looks. It is not the approval gate returning — the
   * write always succeeds — it is Lore declining to SERVE what nobody has read,
   * which is the one thing it genuinely controls.
   */
  quarantineFolders: string[];
  /**
   * Commit every agent write, authored by that agent.
   *
   * Only meaningful when the vault is a git repo. Off by default: committing on
   * somebody's behalf in their repo is not a thing to start doing unasked, and
   * on a vault a human also edits by hand a commit per agent write is noise
   * they did not choose.
   */
  autoCommit: boolean;
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
  protectedPaths: [],
  quarantineFolders: [],
  autoCommit: false,
};


/** Does this rule catch that page? Substring, or /regex/ if written as one. */
export function matches(rule: Rule, id: string, title: string): boolean {
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

