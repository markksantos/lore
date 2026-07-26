import { getActiveVault, type Vault } from "@/lib/config";
import { getIndex, type WikiPage } from "@/lib/wiki";
import type { PageMeta, VaultIndex } from "@/lib/types";

/**
 * Drop the server-only fields before a page crosses the wire: the full
 * plain-text body (search uses it, the client never does), the parsed
 * frontmatter, and the unresolved link list the health check needs.
 */
export function toMeta(page: WikiPage): PageMeta {
  const {
    plain: _plain,
    frontmatter: _frontmatter,
    rawLinks: _rawLinks,
    ...meta
  } = page;
  return meta;
}

export async function requireVault(): Promise<Vault> {
  const vault = await getActiveVault();
  if (!vault) throw new Error("No vault is linked.");
  return vault;
}

export async function loadVaultIndex(force = false): Promise<VaultIndex> {
  const vault = await requireVault();
  const index = await getIndex(vault.root, force);
  return {
    root: index.root,
    name: vault.name,
    pages: index.pages.map(toMeta),
    backlinks: index.backlinks,
    tags: index.tags,
    folders: index.folders,
    errors: index.errors,
    scannedAt: index.scannedAt,
  };
}

/** Uniform JSON error shape so every client fetch can render the same way. */
export function fail(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return Response.json({ error: message }, { status });
}
