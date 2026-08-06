import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * The local database layer for everything Lore observes.
 *
 * Up to this point Lore stored everything as append-only JSONL in `~/.lore`,
 * and for the things it stored — a write journal, a usage log — that was right:
 * a few thousand records, read whole, corrupt lines survivable.
 *
 * The observers are a different size of problem. Ghost writes a frame every
 * fifteen seconds; Ledger indexes a hundred thousand conversation turns; Oracle
 * wants every email, message and file on the machine in one searchable place.
 * Reading a JSONL file of that shape into memory to answer one question is not
 * a design, it is a memory leak with a search box on it.
 *
 * So: SQLite, with FTS5 for the text. Three properties made it the only
 * candidate rather than the obvious one:
 *
 *  1. It is already here. `node:sqlite` ships inside Node itself — no native
 *     module, no `node-gyp`, no electron-rebuild step, no prebuilt binary to
 *     miss an architecture. The packaged desktop app gets the same engine as
 *     `next dev` because it IS the same engine.
 *  2. It is a file. "Delete everything Ghost knows about me" has to be a real
 *     button, and one file per observer makes that `rm`, not a migration.
 *  3. Every source Oracle wants to read — Messages, Notes, Photos, Chrome —
 *     is itself a SQLite database. The reader was going to be required anyway.
 *
 * The experimental-API risk is real and is handled by `available()`: if this
 * Node cannot open a database, the observers report themselves unavailable and
 * the rest of Lore is untouched. Nothing in the wiki half of the product
 * imports this file.
 */

const DIR = path.join(os.homedir(), ".lore", "db");

/**
 * `node:sqlite` is behind a flag in some builds and absent before Node 22.5.
 * Resolved once, lazily, and never thrown from — a missing database engine
 * turns features off, it does not take the app down.
 */
type SqliteModule = {
  DatabaseSync: new (
    location: string,
    options?: { readOnly?: boolean; open?: boolean },
  ) => RawDatabase;
};

/** The subset of `node:sqlite`'s surface this file uses. */
export type RawDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  close(): void;
};

let sqlite: SqliteModule | null | undefined;

function loadSqlite(): SqliteModule | null {
  if (sqlite !== undefined) return sqlite;

  /*
   * Reached at runtime, never imported.
   *
   * A static `import` of a module this Node might not have is a boot failure
   * for the whole server rather than one feature reporting itself unavailable.
   * And Next's bundler rewrites static specifiers: `node:sqlite` is not in its
   * externals list, so it tries to resolve and inline a builtin that has no
   * browser or edge equivalent.
   *
   * `process.getBuiltinModule` is the API Node added for exactly this — a
   * synchronous escape hatch that bundlers cannot see through and that always
   * returns the real builtin. The first attempt here used
   * `createRequire(import.meta.url)`, which works in plain Node and returned
   * null under Turbopack, so every observer reported "this build of Node has
   * no SQLite" on a Node that plainly had it.
   *
   * `createRequire` stays as the fallback for a Node old enough to lack
   * getBuiltinModule (added in 22.3) but new enough to have node:sqlite.
   */
  try {
    const get = (process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }).getBuiltinModule;
    if (typeof get === "function") {
      const found = get.call(process, "node:sqlite") as SqliteModule | undefined;
      if (found?.DatabaseSync) {
        sqlite = found;
        return sqlite;
      }
    }
  } catch {
    /* Fall through to the require path. */
  }

  try {
    sqlite = createRequire(import.meta.url)("node:sqlite") as SqliteModule;
  } catch {
    sqlite = null;
  }
  return sqlite;
}

export function sqliteAvailable(): boolean {
  return loadSqlite() !== null;
}

/**
 * A prepared statement's parameters, positional only.
 *
 * Named parameters work, but mixing the two styles across twenty call sites is
 * how a query ends up silently binding nothing. `?` everywhere, always.
 */
export type Param = string | number | bigint | null | Uint8Array;

export type Db = {
  name: string;
  file: string;
  exec(sql: string): void;
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number };
  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | null;
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[];
  /** Run `fn` inside a transaction, rolling back if it throws. */
  tx<T>(fn: () => T): T;
  close(): void;
};

const open = new Map<string, Db>();

/**
 * Schema versions are integers in SQLite's own `user_version`.
 *
 * Each entry in `migrations` is applied once, in order; the array index plus
 * one is the version it produces. Appending is the only legal edit — editing
 * an existing entry changes what a fresh install gets without changing what an
 * existing one has, which is the classic way two users end up with two
 * different schemas and one bug report.
 */
export function openDb(name: string, migrations: string[]): Db {
  const existing = open.get(name);
  if (existing) return existing;

  const mod = loadSqlite();
  if (!mod) throw new Error("This build of Node has no SQLite, so local indexes are unavailable.");

  fsSync.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DIR, `${name}.db`);
  const raw = new mod.DatabaseSync(file);

  /*
   * Everything from here to `open.set` is inside a try, because a throw in
   * between leaks the handle — and a leaked SQLite handle on a WAL database is
   * not a tidy little resource leak: it holds a lock, so the NEXT open fails
   * too, and the feature is dead until the process restarts. The migration
   * block below has its own close for the same reason.
   */
  let version: number;
  try {
    /* WAL so a long index write does not block a read from the UI, and NORMAL
       sync because everything in here is derived data: the worst case of a
       power cut mid-write is re-indexing, not lost user content. */
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA synchronous = NORMAL");
    raw.exec("PRAGMA foreign_keys = ON");
    /* 5s rather than the 0s default: two writers is normal here (the daemon
       indexing while a request reads), and the default turns that into an
       immediate SQLITE_BUSY instead of a wait nobody notices. */
    raw.exec("PRAGMA busy_timeout = 5000");

    version = Number(
      (raw.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
        ?.user_version ?? 0,
    );
  } catch (error) {
    raw.close();
    throw error;
  }
  for (let i = version; i < migrations.length; i++) {
    raw.exec("BEGIN");
    try {
      raw.exec(migrations[i]);
      raw.exec(`PRAGMA user_version = ${i + 1}`);
      raw.exec("COMMIT");
    } catch (error) {
      try {
        raw.exec("ROLLBACK");
      } catch {
        /* Already rolled back by the failure itself. */
      }
      raw.close();
      throw error;
    }
  }

  const db: Db = {
    name,
    file,
    exec: (sql) => raw.exec(sql),
    run(sql, ...params) {
      const result = raw.prepare(sql).run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    },
    get<T>(sql: string, ...params: Param[]) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    all<T>(sql: string, ...params: Param[]) {
      return raw.prepare(sql).all(...params) as T[];
    },
    tx<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const out = fn();
        raw.exec("COMMIT");
        return out;
      } catch (error) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          /* The failure may already have unwound it. */
        }
        throw error;
      }
    },
    close() {
      open.delete(name);
      raw.close();
    },
  };

  open.set(name, db);
  return db;
}

/** Close every open handle — used before deleting a database file. */
export function closeAll(): void {
  for (const db of [...open.values()]) db.close();
}

/**
 * Delete an observer's entire index, handle and all.
 *
 * WAL means three files, and removing only the `.db` leaves a `-wal` holding
 * the very rows the user just asked to be rid of. Forgetting the sidecars is
 * the difference between "deleted" and "deleted, mostly".
 */
export async function dropDb(name: string): Promise<void> {
  open.get(name)?.close();
  const base = path.join(DIR, `${name}.db`);
  await Promise.all(
    [base, `${base}-wal`, `${base}-shm`].map((f) => fs.rm(f, { force: true })),
  );
}

export async function dbSize(name: string): Promise<number> {
  const base = path.join(DIR, `${name}.db`);
  let total = 0;
  for (const file of [base, `${base}-wal`, `${base}-shm`]) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat) total += stat.size;
  }
  return total;
}

// --------------------------------------------------------------- FTS queries

/**
 * Turn what a person typed into an FTS5 MATCH expression.
 *
 * This is not cosmetic. FTS5's query language treats `-`, `*`, `"`, `:`, `(`,
 * `^` and the bare words AND/OR/NOT as syntax, so passing a human sentence
 * through unescaped does one of two things: throws a syntax error on the
 * apostrophe in "client's", or silently reinterprets "not found" as a boolean
 * negation and returns the opposite of what was asked. Both have the same
 * symptom in the UI — no results — and neither is diagnosable from there.
 *
 * So every token is quoted, which makes it a literal, and the operators are
 * ours to choose rather than the user's to trip over.
 *
 * @param mode `all` requires every token (precision, for a search box);
 *             `any` requires one (recall, for retrieval feeding a model).
 * @param prefix match the final token as a prefix, for as-you-type search.
 */
export function ftsQuery(input: string, mode: "all" | "any" = "all", prefix = false): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 || /\p{N}/u.test(t));
  if (!tokens.length) return null;
  const quoted = tokens.map((t, i) => {
    const escaped = t.replace(/"/g, '""');
    /* The prefix star goes OUTSIDE the quotes — `"foo"*` is a prefix query,
       `"foo*"` is a literal search for a word containing an asterisk. */
    return prefix && i === tokens.length - 1 ? `"${escaped}"*` : `"${escaped}"`;
  });
  return quoted.join(mode === "all" ? " AND " : " OR ");
}

/**
 * The same query, degraded until it matches something.
 *
 * A five-word question with `AND` between every word is right when the corpus
 * is large and wrong the moment one of those words is absent — and "no results"
 * for a question the corpus can nearly answer is the worst outcome a search box
 * has. Callers run these in order and stop at the first that returns rows.
 */
export function ftsLadder(input: string): string[] {
  const strict = ftsQuery(input, "all");
  const loose = ftsQuery(input, "any");
  const out: string[] = [];
  if (strict) out.push(strict);
  if (loose && loose !== strict) out.push(loose);
  return out;
}

// -------------------------------------------------------------- foreign dbs

/**
 * Read a SQLite database that belongs to another application.
 *
 * Messages, Notes, Photos and every Chromium browser keep a live database that
 * is frequently locked and always mid-transaction. Opening those in place is
 * how you get `database is locked` on a good day and someone else's corrupted
 * message history on a bad one.
 *
 * The copy is the whole answer: snapshot the three WAL files to a scratch
 * directory, open the copy read-only, and never hold a handle on anything the
 * user's own apps are writing to. It costs disk and a second — Messages is
 * typically a few hundred megabytes — and it removes an entire class of
 * failure where Lore is blamed for another app's data loss.
 *
 * Returns null when the file does not exist or cannot be read, which on macOS
 * usually means Full Disk Access has not been granted. That is a permission
 * to ask for, not an error to raise.
 */
export async function foreignFingerprint(source: string): Promise<string | null> {
  /*
   * Cheap enough to ask before deciding to copy.
   *
   * Messages' chat.db is routinely several hundred megabytes and the indexer
   * looks at it every five minutes. Copying it in full to discover nothing has
   * changed is most of the cost of the whole feature. The WAL sidecar is part
   * of the fingerprint because that is where recent writes live — a database
   * whose main file has not been touched since the last checkpoint has still
   * gained messages.
   */
  const parts: string[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const stat = await fs.stat(source + suffix).catch(() => null);
    parts.push(stat ? `${Math.round(stat.mtimeMs)}:${stat.size}` : "-");
  }
  return parts[0] === "-" ? null : parts.join("|");
}

export async function openForeignCopy(
  source: string,
): Promise<{ db: Db; dispose: () => Promise<void> } | null> {
  const mod = loadSqlite();
  if (!mod) return null;
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile()) return null;

  /*
   * A directory per OPEN, not per source file.
   *
   * The name was a hash of the source path alone, so two concurrent readers of
   * chat.db — Oracle indexing while Prophet looks for a contact, which the
   * scheduler makes routine — shared one scratch directory. Whichever finished
   * first deleted the copy the other was still reading from, and the second
   * failed with a corrupt database on a file neither of them owned. The random
   * suffix costs nothing and makes the collision impossible.
   */
  const scratch = path.join(
    os.tmpdir(),
    `lore-${crypto.createHash("sha1").update(source).digest("hex").slice(0, 12)}-${crypto.randomBytes(4).toString("hex")}`,
  );
  await fs.mkdir(scratch, { recursive: true, mode: 0o700 });
  const target = path.join(scratch, path.basename(source));

  try {
    await fs.copyFile(source, target);
    /* The -wal holds every write since the last checkpoint. Copying the main
       file alone can produce a database that is hours stale, or one SQLite
       refuses as malformed. Missing sidecars are normal (a checkpointed
       database has none), so their absence is not an error. */
    for (const suffix of ["-wal", "-shm"]) {
      await fs.copyFile(source + suffix, target + suffix).catch(() => {});
    }
  } catch {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  let raw: RawDatabase;
  try {
    raw = new mod.DatabaseSync(target, { readOnly: true });
    raw.exec("PRAGMA query_only = ON");
  } catch {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  const db: Db = {
    name: path.basename(source),
    file: target,
    exec: (sql) => raw.exec(sql),
    run: () => {
      throw new Error("This database is opened read-only.");
    },
    get<T>(sql: string, ...params: Param[]) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    all<T>(sql: string, ...params: Param[]) {
      return raw.prepare(sql).all(...params) as T[];
    },
    tx<T>(fn: () => T): T {
      return fn();
    },
    close: () => raw.close(),
  };

  return {
    db,
    dispose: async () => {
      try {
        raw.close();
      } catch {
        /* Already closed. */
      }
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Does a table exist in a foreign database?
 *
 * Apple renames tables between OS releases — Messages' `chat_message_join` has
 * outlived several, `ZICCLOUDSYNCINGOBJECT` in Notes has not. Probing beats
 * catching, because a query against a missing table is indistinguishable from
 * a query that legitimately found nothing.
 */
export function hasTable(db: Db, table: string): boolean {
  return Boolean(
    db.get("SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table','view') AND name = ?", table),
  );
}

/** Columns present on a table, for schemas that drift between OS versions. */
export function columnsOf(db: Db, table: string): Set<string> {
  try {
    const rows = db.all<{ name: string }>(`PRAGMA table_info(${JSON.stringify(table)})`);
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}
