// Client-facing shapes. The server's `WikiPage` carries the full plain-text
// body for search; we strip it before it crosses the wire so the vault payload
// stays small no matter how big the wiki gets.

export type PageMeta = {
  id: string;
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  excerpt: string;
  words: number;
  mtime: number;
  links: string[];
};

export type VaultIndex = {
  root: string;
  name: string;
  pages: PageMeta[];
  backlinks: Record<string, string[]>;
  tags: { tag: string; count: number }[];
  folders: { folder: string; count: number }[];
  errors: { relPath: string; message: string }[];
  scannedAt: number;
};

export type SearchResult = {
  page: PageMeta;
  score: number;
  snippet: string | null;
  /** Found by meaning rather than by matching text. Ranked below every literal hit. */
  semantic?: boolean;
};
