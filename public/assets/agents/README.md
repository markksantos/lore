# Brand marks

Logos for the compatibility grid on the landing page (`components/marketing/stack-wall.tsx`).

They are used nominatively — to state which clients Lore works with — not to imply
endorsement, partnership, or any relationship with these companies. Each mark
remains the trademark of its owner. Nothing here is modified beyond the two
mechanical changes noted below.

| File | Source | Notes |
| --- | --- | --- |
| `chatgpt.svg` `claude.svg` `claude-code.svg` `codex.svg` `cursor.svg` | Vendor marks as published | Already coloured, 24×24 |
| `cline.svg` `copilot.svg` `curl.svg` `gemini.svg` `mcp.svg` `obsidian.svg` `windsurf.svg` `zed.svg` | [Simple Icons](https://simpleicons.org) (CC0-1.0) | Path only; the brand's own hex injected as `fill` |
| `continue.svg` | [continuedev/continue](https://github.com/continuedev/continue) (Apache-2.0) | Background disc removed so it sits flat like the others |

Two changes were applied, both mechanical:

- **Simple Icons ships paths without colour.** Each is filled with that brand's
  official hex from the Simple Icons metadata, so the colour is the brand's own
  rather than one chosen here.
- **Continue's plugin icon is drawn on a light disc**, which reads as a filled
  badge next to flat marks. The disc is dropped; the glyph is untouched.

Marks that are near-black by design are forced to white on dark backgrounds in
CSS (`dark:brightness-0 dark:invert`) rather than being recoloured on disk — a
plain inversion would turn curl's navy to peach, inventing a colour the brand
does not have.

To add a tool: drop `<slug>.svg` here and add it to `TOOLS` in
`stack-wall.tsx`. `lib/agents.ts` picks the file up with no other change; a tool
with no file falls back to a tinted monogram rather than an approximated logo,
because a hand-drawn near-miss of a brand mark reads as broken.
