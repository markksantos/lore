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

