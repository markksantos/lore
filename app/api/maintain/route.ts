import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail, requireVault } from "@/lib/server";
import { getIndex, health, readRaw, writeRaw } from "@/lib/wiki";
import { vaultKey } from "@/lib/journal";
import { readPolicy, windowFor } from "@/lib/policy";
import { recordActivity } from "@/lib/collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(os.homedir(), ".lore");
const trendPath = (key: string) => path.join(DIR, `trend-${key}.jsonl`);

/**
 * Maintenance: merging duplicates, tracking health over time, and recording
 * where a page came from.
 *
 * The common thread is that each turns a one-off observation into something
 * durable. Health already reports a score; a score with no history cannot tell
 * you whether the wiki is getting better, which is the only question that
 * actually changes behaviour.
 */

type Trend = { at: number; score: number; pages: number; dead: number; orphans: number; stale: number };

async function snapshotTrend(root: string): Promise<Trend[]> {
  const policy = await readPolicy(root);
  const report = await health(root, (id, title) => windowFor(policy, id, title).days);
  const point: Trend = {
    at: Date.now(),
    score: report.score,
    pages: report.pages,
    dead: report.unresolved.length,
    orphans: report.orphans.length,
    stale: report.stale.length,
  };

  const key = vaultKey(root);
  const raw = await fs.readFile(trendPath(key), "utf8").catch(() => "");
  const points: Trend[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      points.push(JSON.parse(line) as Trend);
    } catch {
      // Torn line; skip.
    }
  }

  // At most one point per day. This is called on every visit to the report, and
  // a trend sampled per page-view measures how often you looked at it.
  const today = new Date(point.at).toDateString();
  const already = points.some((p) => new Date(p.at).toDateString() === today);
  if (!already) {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(trendPath(key), JSON.stringify(point) + "\n", "utf8").catch(() => {});
    points.push(point);
  }

  return points.slice(-180);
}

export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const kind = new URL(request.url).searchParams.get("kind") ?? "trend";

    if (kind === "trend") {
      const points = await snapshotTrend(vault.root);
      const first = points[0];
      const last = points[points.length - 1];
      return Response.json({
        points,
        // A delta over fewer than two points is not a trend, and reporting one
        // would invent a direction from a single reading.
        change:
          points.length > 1
            ? { score: last.score - first.score, dead: last.dead - first.dead, days: Math.round((last.at - first.at) / 86_400_000) }
            : null,
      });
    }

    if (kind === "provenance") {
      const index = await getIndex(vault.root);
      const sourced = index.pages.filter((p) => typeof p.frontmatter?.source === "string");
      return Response.json({
        total: index.pages.length,
        sourced: sourced.length,
        pages: sourced.slice(0, 200).map((p) => ({
          id: p.id,
          relPath: p.relPath,
          title: p.title,
          source: String(p.frontmatter.source),
        })),
      });
    }

    return fail(new Error("kind must be trend or provenance."));
  } catch (error) {
    return fail(error, 409);
  }
}

/**
 * POST — merge one page into another, or attach a source to a page.
 *
 * A merge appends the loser's body under a heading and replaces its file with a
 * pointer, rather than deleting it. Deleting would break every link that already
 * pointed at it, which on a wiki with a real link graph is the more expensive
 * failure — and the pointer keeps the old path working while telling both
 * humans and agents where the content went.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as {
      action?: string;
      keep?: string;
      merge?: string;
      relPath?: string;
      source?: string;
    };

    if (body.action === "merge") {
      if (!body.keep || !body.merge) return fail(new Error("Missing keep or merge"));
      if (body.keep === body.merge) return fail(new Error("Those are the same page."));

      const index = await getIndex(vault.root);
      const keep = index.pages.find((p) => p.relPath === body.keep);
      const merge = index.pages.find((p) => p.relPath === body.merge);
      if (!keep || !merge) return fail(new Error("Both pages must exist."), 404);

      const [keepRaw, mergeRaw] = await Promise.all([
        readRaw(vault.root, keep.relPath),
        readRaw(vault.root, merge.relPath),
      ]);

      // Strip the loser's frontmatter — two frontmatter blocks in one file is
      // invalid, and the survivor's metadata should win — and its leading H1,
      // which would otherwise sit as a top-level heading underneath the "Merged
      // from" heading and break the page's outline.
      const bodyOnly = mergeRaw
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/^\s*#\s+.*\n+/, "")
        .trim();

      await writeRaw(
        vault.root,
        keep.relPath,
        `${keepRaw.replace(/\s*$/, "")}\n\n## Merged from ${merge.title}\n\n${bodyOnly}\n`,
      );
      await writeRaw(
        vault.root,
        merge.relPath,
        [
          "---",
          `title: ${JSON.stringify(merge.title)}`,
          `merged_into: ${JSON.stringify(keep.relPath)}`,
          `aliases: [${JSON.stringify(merge.title)}]`,
          "---",
          "",
          `# ${merge.title}`,
          "",
          `This page was merged into [[${keep.id}]]. Its content lives there now.`,
          "",
        ].join("\n"),
      );

      await recordActivity(vault.root, {
        kind: "restored",
        by: "me",
        pageId: merge.id,
        relPath: merge.relPath,
        detail: `merged into ${keep.relPath}`,
      });

      return Response.json({ ok: true, keep: keep.relPath, merged: merge.relPath });
    }

    if (body.action === "source") {
      if (!body.relPath || !body.source) return fail(new Error("Missing relPath or source"));
      const raw = await readRaw(vault.root, body.relPath);
      const line = `source: ${JSON.stringify(body.source)}`;

      const next = /^---\n[\s\S]*?\n---/.test(raw)
        ? raw.replace(/^---\n/, `---\n${line}\n`)
        : `---\n${line}\n---\n\n${raw}`;

      await writeRaw(vault.root, body.relPath, next);
      return Response.json({ ok: true, relPath: body.relPath });
    }

    return fail(new Error("action must be merge or source."));
  } catch (error) {
    return fail(error);
  }
}
