import { promises as fs } from "node:fs";
import { fail } from "@/lib/server";
import {
  askOracle,
  forgetOracle,
  oracleStatus,
  readItem,
  readOracleConfig,
  reindexOracle,
  resetSource,
  searchOracle,
  writeOracleConfig,
  type OracleConfig,
} from "@/lib/oracle";
import { ORACLE_SOURCES, type OracleSource } from "@/lib/oracle-sources";
import { expandPath } from "@/lib/config";
import { detectCapabilities } from "@/lib/capabilities";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { daemonStatus } from "@/lib/daemon";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isSource = (value: unknown): value is OracleSource =>
  typeof value === "string" && (ORACLE_SOURCES as string[]).includes(value);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view === "item") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id)) return fail(new Error("`id` must be a number."));
      const item = readItem(id);
      if (!item) return fail(new Error("No such item."), 404);
      return Response.json({ item });
    }

    if (view === "search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return Response.json({ hits: [], total: 0 });
      const sources = url.searchParams.getAll("source").filter(isSource);
      return Response.json(
        searchOracle(query, {
          sources: sources.length ? sources : null,
          from: Number(url.searchParams.get("from")) || null,
          to: Number(url.searchParams.get("to")) || null,
          limit: Number(url.searchParams.get("limit")) || 40,
        }),
      );
    }

    const [config, status, capabilities, observers] = await Promise.all([
      readOracleConfig(),
      oracleStatus(),
      detectCapabilities(),
      readObservers(),
    ]);

    return Response.json({
      config,
      status,
      fullDiskAccess: capabilities.fullDiskAccess,
      localModel: capabilities.localModel,
      enabled: observers.observers.oracle.enabled,
      running: mayObserve("oracle", observers),
      blockedBecause: whyNot("oracle", observers),
      jobs: daemonStatus().jobs.filter((job) => job.observer === "oracle"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<OracleConfig>;
    const current = await readOracleConfig();
    await writeOracleConfig({
      ...current,
      ...body,
      sources: { ...current.sources, ...(body.sources ?? {}) },
    });
    return Response.json({ config: await readOracleConfig() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      sources?: unknown[];
      source?: unknown;
      question?: string;
      path?: string;
    };
    const requested = Array.isArray(body.sources) ? body.sources.filter(isSource) : undefined;

    switch (body.action) {
      case "reindex": {
        if (!mayObserve("oracle")) {
          return fail(new Error(whyNot("oracle", await readObservers()) ?? "Oracle is off."), 403);
        }
        const result = await reindexOracle(requested);
        return Response.json({ ...result, status: await oracleStatus() });
      }
      case "ask": {
        if (typeof body.question !== "string" || !body.question.trim()) {
          return fail(new Error("Ask something."));
        }
        return Response.json(await askGate.run(() => askOracle(body.question!.trim())));
      }
      case "add-root": {
        /*
         * A folder for the file indexer.
         *
         * Checked to be a real directory before it is stored, because the
         * alternative is a settings list containing a typo that silently
         * indexes nothing and gives no reason why.
         */
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const root = expandPath(body.path);
        if (!root) return fail(new Error("Enter a folder path."));
        const stat = await fs.stat(root).catch(() => null);
        if (!stat) return fail(new Error(`Nothing exists at ${root}`));
        if (!stat.isDirectory()) return fail(new Error(`${root} is a file, not a folder.`));
        const config = await readOracleConfig();
        if (!config.roots.includes(root)) {
          await writeOracleConfig({ ...config, roots: [...config.roots, root] });
        }
        return Response.json({ config: await readOracleConfig() });
      }
      case "remove-root": {
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const config = await readOracleConfig();
        await writeOracleConfig({ ...config, roots: config.roots.filter((r) => r !== body.path) });
        /* The indexed files stay searchable until the source is reset, which is
           a separate deliberate act — removing a folder from the watch list is
           not the same as asking for its contents to be forgotten. */
        return Response.json({ config: await readOracleConfig() });
      }
      case "reset": {
        if (!isSource(body.source)) return fail(new Error("`source` is required."));
        resetSource(body.source);
        return Response.json({ ok: true, status: await oracleStatus() });
      }
      case "forget":
        await forgetOracle();
        return Response.json({ ok: true, status: await oracleStatus() });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}
