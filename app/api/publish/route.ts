import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readPolicy } from "@/lib/policy";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { inQuarantineFolder } from "@/lib/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publish a read-only slice of the wiki as one self-contained HTML file.
 *
 * A wiki is the best artifact most people never show anyone, and the reason is
 * that sharing it has always been all-or-nothing: hand over the folder, or hand
 * over nothing. A folder prefix is the unit people actually think in — "the
 * process pages", "everything about this project" — so that is the unit here.
 *
 * One file, no server, no assets. Whoever you send it to opens it and it works,
 * which is the only property that makes a share actually get read.
 *
 * Three things never leave: quarantined pages, pages in quarantine folders, and
 * anything outside the prefix you asked for. A publish feature that exports one
 * page more than you selected is a publish feature nobody can safely use.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const prefix = (params.get("prefix") ?? "").trim().replace(/^\/+/, "");
    if (!prefix) return fail(new Error("Pass ?prefix= — the folder to publish."));

    const [index, policy] = await Promise.all([getIndex(vault.root), readPolicy(vault.root)]);
    const withheld = new Set(policy.quarantined);

    const pages = index.pages
      .filter((p) => p.relPath.startsWith(prefix))
      .filter((p) => !withheld.has(p.id))
      .filter((p) => !inQuarantineFolder(policy, p.relPath))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));

    if (!pages.length) return fail(new Error(`No pages under "${prefix}".`), 404);

    const titles = new Map(pages.map((p) => [p.id, p.title]));
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const sections = pages.map((page) => {
      const body = renderMarkdown(
        stripLeadingTitle(stripFrontmatter(page.plain), page.title),
        titles,
      );
      return `<section id="${escape(page.id)}"><h2>${escape(page.title)}</h2><p class="path">${escape(page.relPath)}</p>${body}</section>`;
    });

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(prefix)}</title>
<style>
:root { color-scheme: light dark; --ink: #16181d; --dim: #6b7280; --line: #e5e7eb; --bg: #fff; }
@media (prefers-color-scheme: dark) { :root { --ink: #e9eaee; --dim: #9aa1ad; --line: #2a2e37; --bg: #14161a; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 46rem; padding: 3rem 1.25rem 6rem; background: var(--bg); color: var(--ink);
  font: 16px/1.65 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
h1 { font-size: 1.7rem; letter-spacing: -0.02em; margin: 0 0 .35rem; }
h2 { font-size: 1.25rem; letter-spacing: -0.015em; margin: 0 0 .2rem; }
.path, .meta { color: var(--dim); font-size: .8rem; margin: 0 0 1rem; font-variant-numeric: tabular-nums; }
section { border-top: 1px solid var(--line); padding-top: 2rem; margin-top: 2rem; }
nav a { display: block; color: inherit; padding: .15rem 0; }
pre, table { overflow-x: auto; max-width: 100%; }
pre { background: color-mix(in srgb, var(--ink) 6%, transparent); padding: .75rem; border-radius: .5rem; }
img { max-width: 100%; height: auto; }
.lore-wikilink[data-missing] { color: var(--dim); }
</style></head>
<body>
<h1>${escape(prefix.replace(/\/$/, ""))}</h1>
<p class="meta">${pages.length} page${pages.length === 1 ? "" : "s"} from a Lore wiki · exported ${new Date().toISOString().slice(0, 10)}</p>
<nav>${pages.map((p) => `<a href="#${escape(p.id)}">${escape(p.title)}</a>`).join("")}</nav>
${sections.join("\n")}
</body></html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${prefix.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.html"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
