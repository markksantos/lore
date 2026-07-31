import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { readEvents } from "@/lib/usage";
import { readAttribution } from "@/lib/harness";
import { listVersions, readVersion } from "@/lib/history";
import { vaultKey } from "@/lib/journal";
import {
  blame,
  calibration,
  corpusValue,
  findContradictions,
  rescueOrphans,
  type AnalysisPage,
} from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * The analyses that need the whole corpus at once.
 *
 * One route with a `?kind=` rather than five, because they all need the same
 * expensive setup — the index, the ledger and a hash per page — and splitting
 * them would mean paying for it five times.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "all";

    const [index, ledger] = await Promise.all([getIndex(vault.root), readLedger(vault.root)]);
    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));
    const pages: AnalysisPage[] = index.pages.map((p) => ({
      id: p.id,
      title: p.title,
      relPath: p.relPath,
      plain: p.plain,
      words: p.words,
      tags: p.tags,
      folder: p.folder,
      mtime: p.mtime,
      frontmatter: p.frontmatter,
    }));

    if (kind === "blame") {
      const relPath = params.get("path");
      if (!relPath) return fail(new Error("blame needs ?path="));
      const page = pages.find((p) => p.relPath === relPath);
      if (!page) return fail(new Error("Page is not in the vault index."), 404);

      const key = vaultKey(vault.root);
      const versions = await Promise.all(
        (await listVersions(key, relPath)).map(async (v) => ({
          at: v.at,
          text: (await readVersion(key, relPath, v.at)) ?? "",
        })),
      );
      const current = index.pages.find((p) => p.relPath === relPath);
      return Response.json({
        relPath,
        versions: versions.length,
        lines: blame(current?.plain ?? "", versions, await readAttribution(), relPath),
      });
    }

    const out: Record<string, unknown> = {};

    if (kind === "all" || kind === "contradictions") {
      out.contradictions = findContradictions(pages, ledger, hashes);
    }
    if (kind === "all" || kind === "calibration") {
      out.calibration = calibration(pages, ledger, hashes);
    }
    if (kind === "all" || kind === "orphans") {
      const linked = new Set<string>();
      for (const [target, sources] of Object.entries(index.backlinks)) {
        linked.add(target);
        for (const s of sources) linked.add(s);
      }
      const orphans = pages.filter((p) => !linked.has(p.id));
      out.rescue = rescueOrphans(orphans, pages);
      out.orphanCount = orphans.length;
    }
    if (kind === "all" || kind === "value") {
      const events = await readEvents(vault.root);
      const read = new Set(events.filter((e) => e.t === "read").map((e) => e.page));
      const cold = new Set(pages.filter((p) => !read.has(p.id)).map((p) => p.id));
      out.value = corpusValue(pages, ledger, hashes, cold);
    }

    return Response.json(out);
  } catch (error) {
    return fail(error, 409);
  }
}
