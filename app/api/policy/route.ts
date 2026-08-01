import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readPolicy, windowFor, writePolicy, type Policy } from "@/lib/policy";
import { recordActivity } from "@/lib/collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The vault's trust policy: review windows, the decay period, and the
 * quarantine list.
 *
 * GET also returns how many pages each rule currently governs. A rule you
 * cannot see the reach of is a rule you will set wrong — "90 days for anything
 * matching /tool/" sounds reasonable until it turns out to cover 400 pages.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const [policy, index] = await Promise.all([readPolicy(vault.root), getIndex(vault.root)]);

    const counts = new Map<string, number>();
    let fallback = 0;
    for (const page of index.pages) {
      const { rule } = windowFor(policy, page.id, page.title);
      if (rule) counts.set(rule.match, (counts.get(rule.match) ?? 0) + 1);
      else fallback += 1;
    }

    return Response.json({
      policy,
      coverage: policy.rules.map((r) => ({ match: r.match, pages: counts.get(r.match) ?? 0 })),
      fallbackPages: fallback,
      totalPages: index.pages.length,
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** PUT replaces the whole policy; POST toggles a single page's quarantine. */
export async function PUT(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as Partial<Policy>;
    const current = await readPolicy(vault.root);

    const next: Policy = {
      rules: (body.rules ?? current.rules)
        .filter((r) => r.match?.trim() && Number.isFinite(r.days))
        // A window of zero would mark the entire matching set stale on the day
        // it was written, which reads as a bug rather than a policy.
        .map((r) => ({ ...r, days: Math.max(1, Math.round(r.days)) })),
      defaultDays: Math.max(1, Math.round(body.defaultDays ?? current.defaultDays)),
      decayDays: Math.max(1, Math.round(body.decayDays ?? current.decayDays)),
      quarantined: body.quarantined ?? current.quarantined,
      stampFrontmatter: body.stampFrontmatter ?? current.stampFrontmatter,
      /** Prefixes only: a trailing-slash-free entry would match siblings. */
      protectedPaths: (body.protectedPaths ?? current.protectedPaths ?? [])
        .map((f) => f.trim())
        .filter(Boolean),
      quarantineFolders: (body.quarantineFolders ?? current.quarantineFolders ?? [])
        .map((f) => f.trim())
        .filter(Boolean),
      autoCommit: body.autoCommit ?? current.autoCommit ?? false,
    };

    await writePolicy(vault.root, next);
    return Response.json({ ok: true, policy: next });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { pageId?: string; quarantined?: boolean };
    if (!body.pageId) return fail(new Error("Missing pageId"));

    const policy = await readPolicy(vault.root);
    const set = new Set(policy.quarantined);
    if (body.quarantined) set.add(body.pageId);
    else set.delete(body.pageId);

    const next = { ...policy, quarantined: [...set] };
    await writePolicy(vault.root, next);
    await recordActivity(vault.root, {
      kind: body.quarantined ? "quarantined" : "released",
      by: "me",
      pageId: body.pageId,
      relPath: null,
    });
    return Response.json({ ok: true, quarantined: next.quarantined });
  } catch (error) {
    return fail(error);
  }
}
