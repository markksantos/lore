"use client";

import { useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";

/* CodeMirror builds its DOM in the constructor, so the whole module is pulled
   in on the client only. `loading` is what the server renders, which keeps the
   frame the same size and avoids a hydration mismatch. */
const CodeMirror = dynamic<ReactCodeMirrorProps>(
  () => import("@uiw/react-codemirror").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex-1 px-5 py-4 text-[13px] text-[var(--lore-text-tertiary)]"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        Loading editor…
      </div>
    ),
  },
);

/* Every colour is a CSS custom property rather than a resolved value, so the
   editor follows the app's light/dark switch without ever rebuilding the
   theme — a CodeMirror theme is a compiled stylesheet, and swapping it on a
   theme change would tear down and recreate the view. */
const loreTheme = EditorView.theme({
  "&": {
    color: "var(--lore-text-primary)",
    backgroundColor: "transparent",
    fontSize: "14px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
    lineHeight: "1.7",
    overflowX: "hidden",
  },
  ".cm-content": {
    padding: "18px 20px 40px",
    caretColor: "var(--lore-accent)",
    maxWidth: "100%",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "2px solid var(--lore-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--lore-accent-tint)" },
  ".cm-placeholder": { color: "var(--lore-text-tertiary)" },
  ".cm-panels": {
    backgroundColor: "var(--lore-surface-raised)",
    color: "var(--lore-text-primary)",
    borderColor: "var(--lore-border)",
  },
  ".cm-panels input, .cm-panels button": {
    borderRadius: "6px",
    border: "1px solid var(--lore-border)",
    backgroundColor: "var(--lore-surface)",
    color: "var(--lore-text-primary)",
    padding: "2px 6px",
  },
  ".cm-searchMatch": { backgroundColor: "var(--lore-accent-tint)" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    outline: "1px solid var(--lore-accent)",
  },
  /* A [[wikilink]] reads as one object mid-prose, matching how the rendered
     note shows it — see `.lore-wikilink` in globals.css. */
  ".cm-lore-wikilink": {
    color: "var(--lore-accent)",
    backgroundColor: "var(--lore-accent-tint)",
    borderRadius: "4px",
    padding: "1px 2px",
  },
  ".cm-tooltip": {
    border: "1px solid var(--lore-border)",
    backgroundColor: "var(--lore-surface)",
    borderRadius: "10px",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    fontSize: "13px",
    maxHeight: "15em",
    minWidth: "min(19rem, 70vw)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    gap: "10px",
    padding: "5px 11px",
    color: "var(--lore-text-primary)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--lore-accent-tint)",
    color: "var(--lore-accent)",
  },
  ".cm-completionLabel": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    flex: "0 0 auto",
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontStyle: "normal",
    fontSize: "11px",
    color: "var(--lore-text-tertiary)",
  },
});

/* Markdown marks (`#`, `*`, backticks) stay tertiary so the prose keeps the
   foreground and the syntax reads as scaffolding. */
const loreHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.28em", fontWeight: "600", lineHeight: "1.35" },
  { tag: tags.heading3, fontSize: "1.12em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700", color: "var(--lore-text-primary)" },
  { tag: tags.emphasis, fontStyle: "italic", color: "var(--lore-text-primary)" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--lore-text-tertiary)" },
  { tag: tags.link, color: "var(--lore-accent)" },
  { tag: tags.url, color: "var(--lore-text-secondary)" },
  {
    tag: tags.monospace,
    color: "var(--lore-text-primary)",
    backgroundColor: "var(--lore-surface-raised)",
    borderRadius: "4px",
  },
  { tag: tags.quote, color: "var(--lore-text-secondary)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--lore-accent)" },
  { tag: tags.contentSeparator, color: "var(--lore-text-tertiary)", fontWeight: "600" },
  { tag: [tags.processingInstruction, tags.comment], color: "var(--lore-text-tertiary)" },
]);

const wikilinkMatcher = new MatchDecorator({
  regexp: /\[\[[^[\]\n]+\]\]/g,
  decoration: Decoration.mark({ class: "cm-lore-wikilink" }),
});

const wikilinkHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wikilinkMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = wikilinkMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Rank: title prefix, then id prefix, then substring, then alphabetical. */
function rank(query: string, title: string, id: string): number {
  if (!query) return 2;
  if (title.startsWith(query)) return 0;
  if (id.startsWith(query)) return 1;
  return 2;
}

/* Inserting the id rather than the title is what makes the link resolvable —
   titles drift, ids don't. The title stays the visible label so picking from
   the list still reads like picking a page. */
function applyWikilink(id: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    // closeBrackets has already dropped a matching "]]" after the cursor for the
    // "[[" that opened this completion; overwrite it instead of stacking "]]]]".
    const trailing = view.state.sliceDoc(to, to + 2) === "]]" ? 2 : 0;
    view.dispatch({
      changes: { from, to: to + trailing, insert: `${id}]]` },
      selection: { anchor: from + id.length + 2 },
      userEvent: "input.complete",
    });
  };
}

function createWikilinkSource(getPages: () => Map<string, string>) {
  return (context: CompletionContext): CompletionResult | null => {
    // Bare "[[" with nothing after it still matches, so the list opens the
    // moment the second bracket lands rather than waiting for a first letter.
    const token = context.matchBefore(/\[\[[^[\]\n]*/);
    if (!token) return null;

    const query = context.state.sliceDoc(token.from + 2, context.pos).toLowerCase();
    const matches: { rank: number; title: string; option: Completion }[] = [];

    for (const [id, title] of getPages()) {
      const lowerTitle = title.toLowerCase();
      const lowerId = id.toLowerCase();
      if (query && !lowerTitle.includes(query) && !lowerId.includes(query)) continue;
      matches.push({
        rank: rank(query, lowerTitle, lowerId),
        title: lowerTitle,
        option: { label: title, detail: id, apply: applyWikilink(id) },
      });
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

    return {
      from: token.from + 2,
      // Filtering and ranking happen above so the id counts as a match too;
      // CodeMirror's own filter only ever sees the label.
      filter: false,
      options: matches.slice(0, 60).map((m) => m.option),
    };
  };
}

/**
 * The markdown editing surface.
 *
 * Prose, not code: no line numbers, no bracket matching, soft wrap on. The one
 * code-editor affordance kept is autocomplete, because a wiki link is only
 * useful if it resolves, and typing an id from memory is how dead links happen.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  pageTitles,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  /** Map of page id -> title, for [[wikilink]] autocomplete. */
  pageTitles: Map<string, string>;
  className?: string;
}) {
  /* Extensions are built once. Reading the live props through refs keeps the
     editor from being reconfigured on every keystroke, which would drop the
     completion list and the undo history mid-edit. */
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);
  const pageTitlesRef = useRef(pageTitles);
  onSaveRef.current = onSave;
  onChangeRef.current = onChange;
  pageTitlesRef.current = pageTitles;

  const handleChange = useCallback((next: string) => {
    onChangeRef.current(next);
  }, []);

  const extensions = useMemo<Extension[]>(
    () => [
      markdown(),
      EditorView.lineWrapping,
      syntaxHighlighting(loreHighlight),
      wikilinkHighlighter,
      autocompletion({
        override: [createWikilinkSource(() => pageTitlesRef.current)],
        icons: false,
        closeOnBlur: true,
      }),
      // Highest precedence so the browser's own Save dialog never wins.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] transition-colors",
        "focus-within:border-[var(--lore-accent)] focus-within:shadow-[0_0_0_3px_var(--lore-accent-tint)]",
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme={loreTheme}
        height="100%"
        className="min-w-0 flex-1 overflow-hidden"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          bracketMatching: false,
          indentOnInput: false,
          rectangularSelection: false,
          crosshairCursor: false,
          lintKeymap: false,
          foldKeymap: false,
          // Replaced wholesale by the wikilink source above — the default
          // word-completion would otherwise pop up over ordinary prose.
          autocompletion: false,
          completionKeymap: false,
          closeBrackets: true,
        }}
      />
    </div>
  );
}
