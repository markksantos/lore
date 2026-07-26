import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex, readRaw } from "@/lib/wiki";
import { primeShadow, readJournal, vaultKey, watchVault } from "@/lib/journal";
import { hubs, readLedger, triage, trustOf, unverifyPage, verifyPage } from "@/lib/verify";

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

    const [events, ledger] = await Promise.all([
      readJournal(vaultKey(vault.root), Date.now() - days * 86_400_000),
      readLedger(vault.root),
    ]);

    const pageMap = new Map(
      index.pages.map((p) => [p.id, { id: p.id, title: p.title, relPath: p.relPath }]),
    );

    const counts = { verified: 0, lapsed: 0, aging: 0, unverified: 0 };
    for (const page of index.pages) {
      counts[trustOf(ledger, page.id, hashes.get(page.id) ?? "")] += 1;
    }

    return Response.json({
      watching: true,
      days,
      events: events.length,
      counts,
      triage: triage(events, pageMap, index.backlinks, ledger, hashes),
      hubs: hubs(index.backlinks, pageMap, ledger, hashes),
    });
  } catch (error) {
    return fail(error, 409);
  }
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
      return Response.json({ ok: true, trust: "unverified" });
    }

    const { hashes } = await currentHashes(vault.root);
    const hash = hashes.get(body.pageId);
    if (!hash) return fail(new Error("That page is not in the vault."), 404);

    await verifyPage(vault.root, body.pageId, hash, "me", body.note);
    return Response.json({ ok: true, trust: "verified" });
  } catch (error) {
    return fail(error);
  }
}
