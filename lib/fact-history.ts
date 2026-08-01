import { listVersions, readVersion } from "@/lib/history";
import { extractClaims, type Claim, type ClaimKind } from "@/lib/claims";
import { toPlainText } from "@/lib/index-core";

/**
 * How a page's facts changed, rather than how its lines changed.
 *
 * The version list already shows a line diff, and a line diff answers the wrong
 * question. "+12 −31" tells you the page was edited. What you want to know is
 * that the rate on it has been $100, then $150, then $120, and that the last
 * change was made by an agent at two in the morning — because that is the shape
 * of a fact drifting, and it is invisible in a diff that shows a rewritten
 * paragraph around it.
 *
 * Built on the same claim extractor as the contradiction detector, so a value
 * that moves between two differently-worded sentences is still recognised as
 * one fact changing rather than two unrelated ones appearing.
 */

export type FactChange = {
  /** The vocabulary that identifies this fact across versions. */
  subject: string;
  kind: ClaimKind;
  unit: string;
  timeline: {
    at: number;
    value: number;
    /** The sentence as it read in that version. */
    text: string;
  }[];
};

/** Same fact, differently worded? Compared on rarest-first shared vocabulary. */
function sameFact(a: Claim, b: Claim): boolean {
  if (a.kind !== b.kind || a.unit !== b.unit) return false;
  const setB = new Set(b.terms);
  const shared = a.terms.filter((t) => setB.has(t)).length;
  return shared >= 2 && shared / Math.min(a.terms.length, b.terms.length) >= 0.5;
}

/**
 * Every fact on this page that has ever held more than one value.
 *
 * Versions are read oldest-first so a timeline reads forwards. A fact that has
 * only ever said one thing is dropped: it is the page working, and listing it
 * would bury the two or three that are actually moving.
 */
export async function factHistory(
  key: string,
  relPath: string,
  currentRaw: string | null,
  limit = 12,
): Promise<FactChange[]> {
  const versions = (await listVersions(key, relPath).catch(() => [])).sort(
    (a, b) => a.at - b.at,
  );
  if (!versions.length && !currentRaw) return [];

  const snapshots: { at: number; plain: string }[] = [];
  for (const version of versions) {
    const content = await readVersion(key, relPath, version.at).catch(() => null);
    if (content !== null) snapshots.push({ at: version.at, plain: toPlainText(content) });
  }
  if (currentRaw !== null) {
    snapshots.push({ at: Date.now(), plain: toPlainText(currentRaw) });
  }
  if (snapshots.length < 2) return [];

  const tracks: { claims: Claim[]; times: number[] }[] = [];

  for (const snapshot of snapshots) {
    const claims = extractClaims(
      {
        id: relPath,
        relPath,
        title: relPath,
        plain: snapshot.plain,
        mtime: snapshot.at,
      },
      60,
    );
    for (const claim of claims) {
      const track = tracks.find((t) => sameFact(t.claims[0], claim));
      if (track) {
        // The same value restated in a later version is not a change; only a
        // different value extends the timeline.
        if (track.claims[track.claims.length - 1].value !== claim.value) {
          track.claims.push(claim);
          track.times.push(snapshot.at);
        }
      } else {
        tracks.push({ claims: [claim], times: [snapshot.at] });
      }
    }
  }

  return tracks
    .filter((t) => t.claims.length > 1)
    .map((t) => ({
      subject: t.claims[0].terms.slice(0, 4).join(" "),
      kind: t.claims[0].kind,
      unit: t.claims[0].unit,
      timeline: t.claims.map((c, i) => ({
        at: t.times[i],
        value: c.value,
        text: c.text,
      })),
    }))
    // Most-changed first: a number that has moved four times is a number
    // somebody is arguing with.
    .sort((a, b) => b.timeline.length - a.timeline.length)
    .slice(0, limit);
}
