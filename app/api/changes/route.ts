import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readJournal, vaultKey, watchVault } from "@/lib/journal";
import { readLedger, trustOf } from "@/lib/verify";
import { readPolicy } from "@/lib/policy";
import { attributionByPath, readAttribution } from "@/lib/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * What changed since a timestamp.
 *
 * The catch-up problem: an agent that worked on this wiki last week has no
 * cheap way to learn what moved. Its options were to re-read the index — which
 * says nothing about change — or to re-read pages it already knows. On a corpus
 * of 1,400 pages with 300 changes a week, both are wasteful and neither is
 * accurate.
 *
 * `?since=` is a millisecond timestamp; the response carries `now` so the caller
 * can pass it back next time and get an exact, non-overlapping window.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    await watchVault(vault.root);

    const params = new URL(request.url).searchParams;
    const now = Date.now();
    const since = Number(params.get("since") ?? 0) || now - 7 * 86_400_000;

    const [events, index, ledger, policy, attributions] = await Promise.all([
      readJournal(vaultKey(vault.root), since),
      getIndex(vault.root),
      readLedger(vault.root),
      readPolicy(vault.root),
      readAttribution(since),
    ]);

    const byPath = attributionByPath(attributions, vault.root);
    const byRelPath = new Map(index.pages.map((p) => [p.relPath, p]));
    const withheld = new Set(policy.quarantined);

    // Collapse to one row per page. Ten edits to the same page over a week is
    // one thing to catch up on, not ten, and the totals still add up.
    const merged = new Map<
      string,
      {
        relPath: string;
        title: string | null;
        kinds: string[];
        linesAdded: number;
        linesRemoved: number;
        at: number;
        agent: string | null;
        trust: string | null;
        gone: boolean;
      }
    >();

    for (const event of events) {
      const page = byRelPath.get(event.relPath);
      if (page && withheld.has(page.id)) continue;

      const row = merged.get(event.relPath) ?? {
        relPath: event.relPath,
        title: page?.title ?? null,
        kinds: [] as string[],
        linesAdded: 0,
        linesRemoved: 0,
        at: 0,
        agent: byPath[event.relPath]?.agent ?? null,
        trust: page ? trustOf(ledger, page.id, hashOf(page.plain), now, policy.decayDays) : null,
        // A page in the journal but not the index was deleted. Worth saying so
        // explicitly: an agent that still holds a link to it needs to know.
        gone: !page,
      };
      row.kinds.push(event.kind);
      row.linesAdded += event.linesAdded;
      row.linesRemoved += event.linesRemoved;
      row.at = Math.max(row.at, event.at);
      merged.set(event.relPath, row);
    }

    const changes = [...merged.values()]
      .map((row) => ({ ...row, kinds: [...new Set(row.kinds)] }))
      .sort((a, b) => b.at - a.at);

    return Response.json({
      since,
      now,
      pages: changes.length,
      events: events.length,
      changes,
    });
  } catch (error) {
    return fail(error, 409);
  }
}
