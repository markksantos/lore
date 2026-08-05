import { promises as fs } from "node:fs";
import path from "node:path";
import { fail } from "@/lib/server";
import {
  askLedger,
  forgetLedger,
  IMPORTS_DIR,
  ledgerStatus,
  listSessions,
  readLedgerConfig,
  readSession,
  reindexLedger,
  searchLedger,
  writeLedgerConfig,
  type LedgerConfig,
  type LedgerSource,
} from "@/lib/ledger";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { daemonStatus } from "@/lib/daemon";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ledger's one endpoint.
 *
 * Reading is never gated on consent. The switch controls whether Lore goes
 * looking at your transcripts; once something is indexed, searching it is
 * searching your own data, and locking the search behind the same switch would
 * mean pausing indexing also deleted your ability to find last week's answer.
 * Re-indexing IS gated, because that is the part that reads new files.
 */

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const source = (url.searchParams.get("source") as LedgerSource | null) || null;

    if (view === "session") {
      const id = url.searchParams.get("id");
      if (!id) return fail(new Error("`id` is required."));
      const session = readSession(id);
      if (!session) return fail(new Error("No such session."), 404);
      return Response.json(session);
    }

    if (view === "sessions") {
      return Response.json(
        listSessions({
          source,
          project: url.searchParams.get("project"),
          limit: Number(url.searchParams.get("limit")) || 50,
          offset: Number(url.searchParams.get("offset")) || 0,
        }),
      );
    }

    if (view === "search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return Response.json({ query: "", hits: [], sessions: [], total: 0 });
      return Response.json(
        searchLedger(query, {
          source,
          from: Number(url.searchParams.get("from")) || null,
          to: Number(url.searchParams.get("to")) || null,
          limit: Number(url.searchParams.get("limit")) || 40,
        }),
      );
    }

    const [config, status, observers] = await Promise.all([
      readLedgerConfig(),
      ledgerStatus(),
      readObservers(),
    ]);
    /* Shown on the import card so the folder is discoverable without a docs
       trip — and created here, so "drop a file in it" is not advice about a
       directory that does not exist. */
    await fs.mkdir(IMPORTS_DIR, { recursive: true, mode: 0o700 }).catch(() => {});
    const pendingImports = (await fs.readdir(IMPORTS_DIR).catch(() => [])).filter(
      (name) => !name.startsWith("."),
    );

    return Response.json({
      config,
      status,
      enabled: observers.observers.ledger.enabled,
      running: mayObserve("ledger", observers),
      blockedBecause: whyNot("ledger", observers),
      importsDir: IMPORTS_DIR,
      pendingImports,
      jobs: daemonStatus().jobs.filter((job) => job.observer === "ledger"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<LedgerConfig>;
    const current = await readLedgerConfig();
    await writeLedgerConfig({ ...current, ...body, sources: { ...current.sources, ...(body.sources ?? {}) } });
    return Response.json({ config: await readLedgerConfig() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      sources?: LedgerSource[];
      question?: string;
      name?: string;
      content?: string;
    };

    switch (body.action) {
      case "reindex": {
        if (!mayObserve("ledger")) {
          return fail(new Error(whyNot("ledger", await readObservers()) ?? "Ledger is off."), 403);
        }
        const result = await reindexLedger(body.sources);
        return Response.json({ ...result, status: await ledgerStatus() });
      }
      case "ask": {
        if (typeof body.question !== "string" || !body.question.trim()) {
          return fail(new Error("Ask something."));
        }
        return Response.json(await askGate.run(() => askLedger(body.question!.trim())));
      }
      case "import": {
        /*
         * Write an export into the imports folder from the browser.
         *
         * The filename is reduced to a basename and re-joined, so a name of
         * `../../.ssh/authorized_keys` lands as `authorized_keys` inside the
         * imports directory rather than anywhere else. The resolved path is
         * then re-checked against the directory, because "basename is enough"
         * is exactly the kind of reasoning that ages badly.
         */
        if (typeof body.name !== "string" || typeof body.content !== "string") {
          return fail(new Error("`name` and `content` are required."));
        }
        const safe = path.basename(body.name).replace(/[^\w.\-]+/g, "_").slice(0, 120);
        if (!safe || safe === "." || safe === "..") return fail(new Error("Bad filename."));
        const target = path.resolve(IMPORTS_DIR, safe);
        if (!target.startsWith(path.resolve(IMPORTS_DIR) + path.sep)) {
          return fail(new Error("Bad filename."));
        }
        if (body.content.length > 200 * 1024 * 1024) {
          return fail(new Error("That export is larger than 200 MB."));
        }
        await fs.mkdir(IMPORTS_DIR, { recursive: true, mode: 0o700 });
        await fs.writeFile(target, body.content, "utf8");
        if (!mayObserve("ledger")) {
          return Response.json({
            saved: safe,
            indexed: false,
            note: "Saved. Turn Ledger on to index it.",
          });
        }
        const result = await reindexLedger(["import"]);
        return Response.json({ saved: safe, indexed: true, ...result, status: await ledgerStatus() });
      }
      case "forget":
        await forgetLedger();
        return Response.json({ ok: true, status: await ledgerStatus() });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}
