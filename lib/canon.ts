import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";
import { extractClaims, terms as termsOf, type Claim } from "@/lib/claims";

/**
 * Canon — the handful of facts you assert yourself.
 *
 * Everything else in Lore infers. Trust is inferred from a sign-off,
 * contradictions from vocabulary overlap, staleness from a filename. All of it
 * is a guess about which of two pages is right, and all of it can be wrong.
 *
 * Canon is the escape hatch: a short list of statements the human states
 * directly, which no agent can overrule and no inference can outvote. "The
 * video edit floor is $150." "The app runs on port 4646." Small, hand-written,
 * and load-bearing — because on a wiki that a dozen agents write to, the only
 * thing that reliably stops a wrong fact spreading is somebody saying which
 * fact is right.
 *
 * The cost of getting this wrong is high in one specific direction: canon that
 * fires on unrelated pages trains you to ignore it. So a canon fact only ever
 * flags a claim that is the same KIND of measurement, about the same subject,
 * with a different value — the same test the contradiction detector uses, with
 * one side pinned.
 *
 * Stored outside the vault, like the ledger, so asserting a fact does not
 * modify a single file of the user's notes.
 */

const DIR = path.join(os.homedir(), ".lore");
const filePath = (key: string) => path.join(DIR, `canon-${key}.json`);

export type CanonFact = {
  id: string;
  /** The statement, as the human wrote it. */
  text: string;
  addedAt: number;
  /** Optional page this fact is documented on, for a "read more" link. */
  pageId?: string;
};

export type CanonViolation = {
  fact: CanonFact;
  claim: Claim;
  /** What canon says the value is, against what the page says. */
  canonValue: number;
  confidence: number;
};

export async function readCanon(root: string): Promise<CanonFact[]> {
  const raw = await fs.readFile(filePath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CanonFact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(root: string, facts: CanonFact[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath(vaultKey(root)), JSON.stringify(facts, null, 2), "utf8");
}

export async function addCanon(
  root: string,
  text: string,
  pageId?: string,
): Promise<CanonFact[]> {
  const trimmed = text.trim();
  if (!trimmed) return readCanon(root);
  const facts = await readCanon(root);
  const next = [
    ...facts.filter((f) => f.text.trim().toLowerCase() !== trimmed.toLowerCase()),
    { id: `c${Date.now().toString(36)}`, text: trimmed, addedAt: Date.now(), pageId },
  ];
  await write(root, next);
  return next;
}

export async function removeCanon(root: string, id: string): Promise<CanonFact[]> {
  const next = (await readCanon(root)).filter((f) => f.id !== id);
  await write(root, next);
  return next;
}

/**
 * Turn a canon statement into claims, by running it through the same extractor
 * the wiki goes through.
 *
 * Using one implementation for both sides is what makes the comparison mean
 * something: a fact written as "$150 per finished video" and a page written as
 * "the floor is 150 USD/video" become the same typed claim, and any second
 * parser would eventually disagree with the first about which is which.
 */
function claimsOfFact(fact: CanonFact): Claim[] {
  return extractClaims({
    id: `canon:${fact.id}`,
    relPath: "canon",
    title: "canon",
    plain: fact.text,
    mtime: fact.addedAt,
  });
}

/** How much two subjects overlap, unweighted — canon is too small for IDF. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / Math.min(a.length, b.length);
}

/** Canon needs this much subject agreement before it contradicts a page. */
const MIN_OVERLAP = 0.6;
const MIN_SHARED = 2;

/**
 * Pages that disagree with something you have asserted.
 *
 * Ordered by how recently the offending page was touched: a page edited
 * yesterday that contradicts canon is a live problem, and one from March is
 * history somebody forgot to clean up.
 */
export function canonViolations(
  facts: CanonFact[],
  pages: { id: string; relPath: string; title: string; plain: string; mtime: number }[],
  limit = 40,
): CanonViolation[] {
  if (!facts.length) return [];

  const pinned = facts.flatMap((fact) =>
    claimsOfFact(fact).map((claim) => ({ fact, claim, keyTerms: claim.terms })),
  );
  if (!pinned.length) return [];

  const out: CanonViolation[] = [];

  for (const page of pages) {
    for (const claim of extractClaims(page, 60)) {
      if (claim.soft) continue;
      for (const { fact, claim: canonClaim, keyTerms } of pinned) {
        if (claim.kind !== canonClaim.kind || claim.unit !== canonClaim.unit) continue;
        if (claim.value === canonClaim.value) continue;
        const shared = keyTerms.filter((t) => claim.terms.includes(t));
        if (shared.length < MIN_SHARED) continue;
        const score = overlap(keyTerms, claim.terms);
        if (score < MIN_OVERLAP) continue;
        out.push({ fact, claim, canonValue: canonClaim.value, confidence: score });
      }
    }
  }

  return out.sort((a, b) => b.claim.at - a.claim.at).slice(0, limit);
}

/**
 * The canon block an agent is shown.
 *
 * Prepended to every context pack, unconditionally and outside the token
 * budget. It is a few dozen tokens and it is the only part of the wiki that is
 * guaranteed true, so paying for it out of the passage budget — where a long
 * question could crowd it out — would be exactly backwards.
 */
export function renderCanon(facts: CanonFact[]): string {
  if (!facts.length) return "";
  return [
    "## Canon — stated by the wiki's owner, overrides anything below",
    "",
    ...facts.map((f) => `- ${f.text}`),
    "",
  ].join("\n");
}

/** Content terms of a statement, for callers building their own comparisons. */
export const canonTerms = termsOf;
