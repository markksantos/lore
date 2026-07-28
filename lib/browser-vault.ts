"use client";

import {
  MARKDOWN,
  SKIP_DIRS,
  buildIndex,
  ignored,
  parseIgnore,
  parsePage,
  type WikiIndex,
  type WikiPage,
} from "@/lib/index-core";

/**
 * Lore, in a browser tab, reading the actual folder on your disk.
 *
 * The obvious question about a local-first app is "so where is the web
 * version?", and the obvious answer — upload your wiki to us — is the one thing
 * this product exists not to do. The File System Access API is the way out:
 * `showDirectoryPicker()` hands the page a handle to a real directory that the
 * user chose, and everything below reads through that handle. No bytes leave
 * the machine, there is no account, and the server that served the page is not
 * involved again.
 *
 * The handle survives a reload — it is structured-cloneable, so IndexedDB can
 * store it — which is what makes this an app rather than a file viewer. Chrome
 * still re-asks for permission on a fresh session; that prompt is the security
 * model working, and we ask for it explicitly rather than letting the app look
 * broken.
 *
 * Read-only by design. We ask for `mode: "read"`, so the browser will refuse a
 * write even if this code tried one. That is a stronger promise than the desktop
 * app's read-only switch, which Lore enforces on itself; here the enforcement
 * belongs to the browser.
 *
 * Firefox and Safari have not shipped the API. There is no polyfill worth
 * having — a folder <input> gives you a snapshot of file contents with no live
 * handle and no permission model — so those browsers are told plainly to use
 * the download instead.
 */

export const SUPPORTED =
  typeof globalThis !== "undefined" && "showDirectoryPicker" in globalThis;

type DirHandle = FileSystemDirectoryHandle;

const DB = "lore-web";
const STORE = "handles";
const KEY = "vault";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idb();
  return new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as T) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

/** Ask for a folder. Returns null if the user cancels the picker. */
export async function pickFolder(): Promise<DirHandle | null> {
  try {
    const handle = await (
      globalThis as unknown as {
        showDirectoryPicker: (o: { mode: "read" }) => Promise<DirHandle>;
      }
    ).showDirectoryPicker({ mode: "read" });
    await idbPut(KEY, handle);
    return handle;
  } catch {
    // AbortError when the picker is dismissed. Not an error worth surfacing.
    return null;
  }
}

/**
 * The folder from last time, if the browser will still let us read it.
 *
 * `prompt: false` first, so a returning user who already granted access lands
 * straight in their wiki. Chrome commonly drops the grant between sessions; the
 * caller then shows a one-click re-grant rather than a picker, because being
 * asked to find your own folder again reads as the app having lost it.
 */
export async function restoreFolder(): Promise<{
  handle: DirHandle;
  granted: boolean;
} | null> {
  const handle = await idbGet<DirHandle>(KEY);
  if (!handle) return null;
  const query = (
    handle as unknown as {
      queryPermission: (o: { mode: "read" }) => Promise<PermissionState>;
    }
  ).queryPermission;
  if (typeof query !== "function") return { handle, granted: false };
  const state = await query.call(handle, { mode: "read" }).catch(() => "prompt");
  return { handle, granted: state === "granted" };
}

/** Re-ask for permission on a stored handle. Must be called from a user gesture. */
export async function requestAccess(handle: DirHandle): Promise<boolean> {
  const request = (
    handle as unknown as {
      requestPermission: (o: { mode: "read" }) => Promise<PermissionState>;
    }
  ).requestPermission;
  if (typeof request !== "function") return false;
  const state = await request.call(handle, { mode: "read" }).catch(() => "denied");
  return state === "granted";
}

export async function forgetFolder(): Promise<void> {
  await idbDelete(KEY);
}

// ------------------------------------------------------------------ scanning

type RawFile = { relPath: string; text: string; mtime: number };

/**
 * Walk the directory tree, collecting markdown.
 *
 * Reads are issued in batches rather than one at a time: a 1,500-page wiki is
 * 1,500 round trips through the file handle, and serially that is a visibly
 * slow start. The batch size is a compromise — large enough to saturate, small
 * enough not to hold the whole vault's text in flight at once.
 */
const BATCH = 32;

async function collect(
  dir: DirHandle,
  prefix: string,
  out: { relPath: string; file: FileSystemFileHandle }[],
  patterns: RegExp[],
  onProgress?: (found: number) => void,
): Promise<void> {
  // @ts-expect-error - values() is not in the lib.dom types Next ships with.
  for await (const entry of dir.values() as AsyncIterable<FileSystemHandle>) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (ignored(patterns, rel)) continue;
    if (entry.kind === "directory") {
      if (entry.name.startsWith(".")) continue;
      await collect(entry as DirHandle, rel, out, patterns, onProgress);
    } else if (MARKDOWN.test(entry.name)) {
      out.push({ relPath: rel, file: entry as FileSystemFileHandle });
      if (out.length % 100 === 0) onProgress?.(out.length);
    }
  }
}

async function readIgnoreFile(dir: DirHandle): Promise<RegExp[]> {
  try {
    const handle = await dir.getFileHandle(".loreignore");
    return parseIgnore(await (await handle.getFile()).text());
  } catch {
    return [];
  }
}

export type ScanProgress = { phase: "listing" | "reading"; done: number; total: number };

export async function scan(
  handle: DirHandle,
  onProgress?: (p: ScanProgress) => void,
): Promise<{ index: WikiIndex; texts: Map<string, string> }> {
  const patterns = await readIgnoreFile(handle);
  const found: { relPath: string; file: FileSystemFileHandle }[] = [];
  await collect(handle, "", found, patterns, (n) =>
    onProgress?.({ phase: "listing", done: n, total: 0 }),
  );

  const pages: WikiPage[] = [];
  const errors: { relPath: string; message: string }[] = [];
  const texts = new Map<string, string>();

  for (let i = 0; i < found.length; i += BATCH) {
    const slice = found.slice(i, i + BATCH);
    const read = await Promise.all(
      slice.map(async ({ relPath, file }): Promise<RawFile | { relPath: string; error: string }> => {
        try {
          const f = await file.getFile();
          return { relPath, text: await f.text(), mtime: f.lastModified };
        } catch (error) {
          return {
            relPath,
            error: error instanceof Error ? error.message : "Unreadable file",
          };
        }
      }),
    );
    for (const item of read) {
      if ("error" in item) errors.push({ relPath: item.relPath, message: item.error });
      else {
        texts.set(item.relPath, item.text);
        pages.push(parsePage(item.relPath, item.text, item.mtime));
      }
    }
    onProgress?.({ phase: "reading", done: Math.min(i + BATCH, found.length), total: found.length });
  }

  return { index: buildIndex(handle.name, pages, errors), texts };
}

// -------------------------------------------------------------------- ledger

/**
 * The verification ledger, browser edition.
 *
 * Same shape as the desktop one in lib/verify.ts, stored per folder name in
 * localStorage. Per folder name and not per path because the browser is never
 * told the absolute path — a deliberate limitation of the API, and one worth
 * naming: two different folders both called "wiki" would share a ledger here.
 * The desktop app has the real path and does not have this problem, which is
 * one honest reason to prefer it.
 */
export type Verification = { hash: string; at: number; by: string; note?: string };
export type Ledger = Record<string, Verification>;

const ledgerKey = (name: string) => `lore-web-ledger:${name}`;

export function readLedger(name: string): Ledger {
  try {
    return JSON.parse(localStorage.getItem(ledgerKey(name)) ?? "{}") as Ledger;
  } catch {
    return {};
  }
}

export function writeLedger(name: string, ledger: Ledger): void {
  localStorage.setItem(ledgerKey(name), JSON.stringify(ledger));
}

/**
 * Content hash, matching what the server pins a verification to.
 *
 * Not SHA-1 — WebCrypto's digest is async and this is called once per page
 * while rendering a list. This is FNV-1a over the plain text, which is not a
 * cryptographic hash and does not need to be: the only question it answers is
 * "is this the same text I signed off on", where an accidental collision is the
 * only collision available. The ledger never leaves this browser, so nobody can
 * pick a colliding page to fool it with.
 */
export function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}
