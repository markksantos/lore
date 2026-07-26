import { fail, requireVault } from "@/lib/server";
import { buildAgentIndex, readRaw, writeRaw } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent-facing map of the vault, as plain markdown. This is the single
 * endpoint an agent needs before it knows anything: hand it this, and it can
 * pick the two or three pages that actually matter instead of reading the
 * whole wiki or grepping blind.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const markdown = await buildAgentIndex(vault.root, vault.name);
    return new Response(markdown, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** The fence Lore writes between its generated map and anything you wrote. */
const BEGIN = "<!-- lore:begin -->";
const END = "<!-- lore:end -->";

/**
 * Write the map into AGENTS.md at the vault root.
 *
 * This used to overwrite the file wholesale, which was a data-loss bug aimed
 * squarely at the people this product is for: anyone following the llm-wiki
 * pattern already keeps a hand-written AGENTS.md, and pressing the button
 * destroyed it.
 *
 * Now the generated map lives inside a fenced block and everything outside the
 * fence is preserved verbatim. A file with no fence gets the map appended below
 * what is already there, never on top of it. `?force=1` is the explicit escape
 * hatch for replacing the whole file.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const force = new URL(request.url).searchParams.get("force") === "1";
    const map = await buildAgentIndex(vault.root, vault.name);
    const block = `${BEGIN}\n${map}\n${END}`;

    const existing = await readRaw(vault.root, "AGENTS.md").catch(() => null);

    let next: string;
    let mode: "created" | "replaced-block" | "appended" | "overwritten";

    if (existing === null) {
      next = block + "\n";
      mode = "created";
    } else if (force) {
      next = block + "\n";
      mode = "overwritten";
    } else if (existing.includes(BEGIN) && existing.includes(END)) {
      const before = existing.slice(0, existing.indexOf(BEGIN));
      const after = existing.slice(existing.indexOf(END) + END.length);
      next = before + block + after;
      mode = "replaced-block";
    } else {
      next = `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
      mode = "appended";
    }

    await writeRaw(vault.root, "AGENTS.md", next);
    return Response.json({ ok: true, path: "AGENTS.md", mode, preserved: existing !== null && !force });
  } catch (error) {
    return fail(error);
  }
}
