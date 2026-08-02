import { fail, requireVault } from "@/lib/server";
import { factHistory } from "@/lib/fact-history";
import { vaultKey, watchVault } from "@/lib/journal";
import { listVersions, readVersion, searchHistory } from "@/lib/history";
import { readRaw, writeRaw } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Page history: list versions, read one, search across all of them.
 *
 * `?path=` lists versions of a page. `?path=&at=` returns that version's text.
 * `?q=` searches the text of every stored version, which is the only way to find
 * something an agent deleted — live search cannot match a sentence that is gone.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    // History only accumulates while the watcher is running, so a first visit
    // that starts it is better than one that reports an empty past.
    await watchVault(vault.root);

    const params = new URL(request.url).searchParams;
    const key = vaultKey(vault.root);
    const relPath = params.get("path");
    const query = params.get("q");

    if (query) {
      return Response.json({ hits: await searchHistory(key, query) });
    }

    if (!relPath) return fail(new Error("Pass ?path= or ?q="));

    /*
     * `?facts=1` — how this page's NUMBERS changed, not its lines.
     *
     * A line diff shows that a page was edited. What a reader wants to know is
     * that the rate on it has been $100, then $150, then $120 — a fact drifting,
     * which is invisible in a diff that shows a rewritten paragraph around it.
     * lib/fact-history tracks a value across versions using the same claim
     * extractor as the contradiction detector, so a number that moves between
     * two differently-worded sentences is still one fact changing.
     */
    if (params.get("facts") === "1") {
      const raw = await readRaw(vault.root, relPath).catch(() => null);
      return Response.json({ relPath, facts: await factHistory(key, relPath, raw) });
    }

    const at = params.get("at");
    if (at) {
      const text = await readVersion(key, relPath, Number(at));
      if (text === null) return fail(new Error("No such version."), 404);
      return Response.json({ relPath, at: Number(at), text });
    }

    return Response.json({ relPath, versions: await listVersions(key, relPath) });
  } catch (error) {
    return fail(error, 409);
  }
}

/**
 * Restore a page to a stored version.
 *
 * The current text is written back to history first, so a restore is itself
 * undoable. Rolling back and losing the thing you rolled back from would be a
 * strictly worse failure than the one this exists to fix.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { path?: string; at?: number };
    if (!body.path || !body.at) return fail(new Error("Missing path or at"));

    const text = await readVersion(vaultKey(vault.root), body.path, body.at);
    if (text === null) return fail(new Error("No such version."), 404);

    const current = await readRaw(vault.root, body.path).catch(() => null);
    if (current === text) {
      return Response.json({ ok: true, unchanged: true });
    }

    // The watcher sees this write like any other and snapshots `current`
    // itself, so there is no separate bookkeeping to keep in step.
    await writeRaw(vault.root, body.path, text);
    return Response.json({ ok: true, restored: body.at });
  } catch (error) {
    return fail(error);
  }
}
