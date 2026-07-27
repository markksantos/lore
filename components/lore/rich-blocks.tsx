"use client";

import { useEffect } from "react";
import katex from "katex";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";

/**
 * Renders the diagram and math blocks that the markdown pipeline left as inert
 * markup (see lib/markdown.ts).
 *
 * Both libraries are imported statically. A dynamic import is the textbook
 * answer here — mermaid is larger than the rest of the app — and it was tried
 * first. It failed with no error anywhere: the effect claimed its nodes, the
 * import resolved, and nothing rendered, because React reruns this effect
 * whenever the prose re-renders and the run that owned the pending work was
 * reliably the one being torn down.
 *
 * Static imports remove that whole class of problem. The cost is a larger
 * bundle, which for an app served from 127.0.0.1 is a number nobody experiences.
 * Correctness beats a saving that only exists on a network that isn't there.
 *
 * Failures stay contained per block. A malformed diagram is something a human
 * typed and will fix; it must not take down the page around it, so a broken
 * block shows its own source with the reason and everything else still reads.
 */

let initialised = false;

export function useRichBlocks(html: string, container: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const paint = () => {
      // `:not([data-done])` plus claiming before any await is what stops two
      // overlapping runs rendering the same node twice.
      for (const node of root.querySelectorAll<HTMLElement>(".lore-math:not([data-done])")) {
        node.dataset.done = "1";
        try {
          katex.render(node.textContent ?? "", node, {
            displayMode: node.dataset.display === "1",
            throwOnError: false,
            output: "html",
          });
        } catch {
          node.classList.add("lore-math-error");
        }
      }

      const diagrams = [...root.querySelectorAll<HTMLElement>(".lore-mermaid:not([data-done])")];
      if (!diagrams.length) return;

      if (!initialised) {
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        });
        initialised = true;
      }

      for (const [i, node] of diagrams.entries()) {
        node.dataset.done = "1";
        const source = node.textContent ?? "";
        mermaid
          // The id must be unique per render, or mermaid reuses a previous SVG's
          // definitions and the second diagram on a page comes out empty.
          .render(`lore-diagram-${i}-${Math.random().toString(36).slice(2, 9)}`, source)
          .then(({ svg }) => {
            node.innerHTML = svg;
            node.classList.add("lore-mermaid-rendered");
          })
          .catch((error: unknown) => {
            node.classList.add("lore-mermaid-error");
            node.textContent = `${source}\n\n— diagram could not be drawn: ${
              error instanceof Error ? error.message.split("\n")[0] : "unknown error"
            }`;
          });
        }
    };

    paint();

    /*
     * Watching the DOM rather than trusting the dependency array.
     *
     * This was a real bug, found by measurement: the effect ran once, claimed
     * the blocks, and rendered them — and then React replaced the prose subtree
     * without `html` changing, so the effect never re-ran and the fresh,
     * unclaimed nodes sat there as escaped source forever. Effect dependencies
     * describe React's data, not the identity of the nodes actually on screen,
     * and those came apart here.
     *
     * An observer cannot come apart from it: whatever causes new blocks to
     * appear, they get painted.
     */
    const observer = new MutationObserver(() => paint());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [html, container]);
}
