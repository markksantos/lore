import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex, readRaw, writeRaw } from "@/lib/wiki";
import { primeShadow, readJournal, vaultKey, watchVault } from "@/lib/journal";
import {
  hubs,
  readLedger,
  reconcileRenames,
  triage,
  trustOf,
  stampTrust,
  unverifyPage,
  verifyPage,
} from "@/lib/verify";
import { attributionByPath, readAttribution } from "@/lib/harness";
import { forecast, readPolicy } from "@/lib/policy";
import { recordActivity } from "@/lib/collab";
import { readSafety } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * Build the content-hash map the trust ledger pins against.
 *
 * Hashing the plain-text body rather than the raw file is deliberate: it means
 * a verification survives a frontmatter touch (an agent bumping `updated:`) but
 * lapses the moment the actual prose changes. Otherwise every automated
 * metadata rewrite would silently invalidate work you did check.
 */
async function currentHashes(root: string) {
  // Forced, never cached: a trust verdict computed from a stale scan is worse
  // than no verdict, because it says "verified" about content that has changed.
  const index = await getIndex(root, true);
  const hashes = new Map<string, string>();
  for (const page of index.pages) hashes.set(page.id, hashOf(page.plain));
  return { index, hashes };
}

/** GET — the weekly triage, the hub list, and the whole-corpus trust split. */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const days = Number(new URL(request.url).searchParams.get("days") ?? 7);

    // Watching starts on first read rather than at boot: there is no point
    // journaling a vault nobody has opened, and this keeps startup instant.
    await watchVault(vault.root);

    const { index, hashes } = await currentHashes(vault.root);
    await primeShadow(
      vault.root,
      await Promise.all(
        index.pages.map(async (p) => ({
          relPath: p.relPath,
          text: await readRaw(vault.root, p.relPath).catch(() => ""),
        })),
      ),
    );

    const since = Date.now() - days * 86_400_000;
    const [events, stored, policy, attributions] = await Promise.all([
      readJournal(vaultKey(vault.root), since),
      readLedger(vault.root),
      readPolicy(vault.root),
      readAttribution(since),
    ]);

    // Which harness made each change. Written by the Claude Code hook since the
    // beginning and read by nothing until now, so every change in Review showed
    // as anonymous even when Lore knew exactly who did it.
    const byPath = attributionByPath(attributions, vault.root);

    // Review is where the whole vault is in hand, so it is where a signature
    // that lost its page to a rename gets carried to wherever the page went.
    const ledger = await reconcileRenames(vault.root, stored, hashes);

    const pageMap = new Map(
      index.pages.map((p) => [p.id, { id: p.id, title: p.title, relPath: p.relPath }]),
    );

    const counts = { verified: 0, lapsed: 0, aging: 0, unverified: 0 };
    for (const page of index.pages) {
      counts[
        trustOf(ledger, page.id, hashes.get(page.id) ?? "", Date.now(), policy.decayDays)
      ] += 1;
    }

    const items = triage(events, pageMap, index.backlinks, ledger, hashes).map((item) => ({
      ...item,
      agent: byPath[item.relPath]?.agent ?? null,
      quarantined: policy.quarantined.includes(item.pageId),
    }));

    return Response.json({
      watching: true,
      days,
      events: events.length,
      counts,
      triage: items,
      hubs: hubs(index.backlinks, pageMap, ledger, hashes),
      // What lapses next, so verification is a schedule rather than a discovery.
      forecast: forecast(ledger, index.pages, policy),
      quarantined: policy.quarantined,
      attributed: Object.keys(byPath).length,
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/**
 * Mirror a sign-off into the page's frontmatter, when the vault asked for it.
 *
 * Silent when the vault has not opted in, and silent under read-only mode: the
 * lock exists to guarantee Lore does not touch the user's files, and a sign-off
 * is a note in Lore's own ledger, not a change to the wiki. Blocking the whole
 * sign-off over an optional stamp would be the wrong trade — so the signature
 * lands either way and only the stamp is withheld.
 */
async function stamp(root: string, pageId: string, at: number | null): Promise<void> {
  const [policy, safety] = await Promise.all([readPolicy(root), readSafety()]);
  if (!policy.stampFrontmatter || safety.readOnly) return;

  const index = await getIndex(root);
  const page = index.pages.find((p) => p.id === pageId);
  if (!page) return;

  const current = await readRaw(root, page.relPath).catch(() => null);
  if (current === null) return;
  const next = stampTrust(current, at);
  if (next !== current) await writeRaw(root, page.relPath, next);
}

/** POST — promote a page to verified, or drop a verification. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as {
      action?: "verify" | "unverify";
      pageId?: string;
      note?: string;
    };
    if (!body.pageId) return fail(new Error("Missing pageId"));

    if (body.action === "unverify") {
      await unverifyPage(vault.root, body.pageId);
      await stamp(vault.root, body.pageId, null);
      await recordActivity(vault.root, {
        kind: "unverified",
        by: "me",
        pageId: body.pageId,
        relPath: null,
      });
      return Response.json({ ok: true, trust: "unverified" });
    }

    const { hashes } = await currentHashes(vault.root);
    const hash = hashes.get(body.pageId);
    if (!hash) return fail(new Error("That page is not in the vault."), 404);

    await verifyPage(vault.root, body.pageId, hash, "me", body.note);
    await recordActivity(vault.root, {
      kind: "verified",
      by: "me",
      pageId: body.pageId,
      relPath: null,
      detail: body.note,
    });
    await stamp(vault.root, body.pageId, Date.now());
    return Response.json({ ok: true, trust: "verified" });
  } catch (error) {
    return fail(error);
  }
}
