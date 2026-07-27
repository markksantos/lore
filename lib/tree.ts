import type { VaultIndex } from "@/lib/types";

/**
 * Turn the flat folder list into the hierarchy it actually is.
 *
 * The index reports folders as full paths — `clients/acme/invoices` — which is
 * correct for the engine and unusable for a sidebar. Measured on a real vault:
 * 262 folders, 236 of them three levels deep, 11 at the top. Rendered flat that
 * is a wall of near-identical paths with no way in.
 *
 * Intermediate folders that hold no pages of their own still get a node, since
 * a wiki with `clients/acme/notes.md` and nothing directly in `clients/` still
 * needs `clients` to exist as somewhere to expand.
 */

export type FolderNode = {
  /** Full path, e.g. "clients/acme". "" is the vault root. */
  path: string;
  /** Last segment, for display. */
  name: string;
  depth: number;
  /** Pages directly in this folder. */
  count: number;
  /** Pages in this folder and everything beneath it. */
  total: number;
  children: FolderNode[];
};

export function buildFolderTree(folders: VaultIndex["folders"]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();

  const ensure = (path: string): FolderNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: FolderNode = {
      path,
      name: path === "" ? "Root" : segments[segments.length - 1],
      depth: path === "" ? 0 : segments.length,
      count: 0,
      total: 0,
      children: [],
    };
    nodes.set(path, node);
    return node;
  };

  ensure("");
  for (const entry of folders) {
    ensure(entry.folder).count = entry.count;
    // Materialise every ancestor so the chain is walkable even when nothing
    // lives directly in the middle of it.
    const parts = (entry.folder || "").split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) ensure(parts.slice(0, i).join("/"));
  }

  // Link children to parents.
  for (const node of nodes.values()) {
    if (node.path === "") continue;
    const cut = node.path.lastIndexOf("/");
    const parent = cut === -1 ? "" : node.path.slice(0, cut);
    ensure(parent).children.push(node);
  }

  // Roll totals up from the leaves.
  const total = (node: FolderNode): number => {
    node.total = node.count + node.children.reduce((sum, c) => sum + total(c), 0);
    return node.total;
  };
  const root = nodes.get("")!;
  total(root);

  const sort = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sort);
  };
  sort(root);

  // The root's own pages are shown as a "Root" entry alongside the top-level
  // folders rather than as a container for them — nesting everything under a
  // node called Root adds a level of indentation that buys nothing.
  const top = [...root.children];
  if (root.count > 0) {
    top.unshift({ ...root, name: "Root", children: [], total: root.count });
  }
  return top;
}

/** Flatten to the rows actually visible, given which folders are expanded. */
export function visibleRows(
  tree: FolderNode[],
  expanded: Set<string>,
): FolderNode[] {
  const rows: FolderNode[] = [];
  const walk = (nodes: FolderNode[]) => {
    for (const node of nodes) {
      rows.push(node);
      if (node.children.length && expanded.has(node.path)) walk(node.children);
    }
  };
  walk(tree);
  return rows;
}

/** Every ancestor of a path, so selecting a deep folder can reveal it. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
