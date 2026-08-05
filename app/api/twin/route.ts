import { promises as fs } from "node:fs";
import { fail } from "@/lib/server";
import {
  acceptPattern,
  deleteAutomation,
  dismissPattern,
  forgetTwin,
  listAutomations,
  minePatterns,
  pendingProposals,
  readTwinConfig,
  recentActions,
  runAutomation,
  setAutomation,
  startTwinWatcher,
  stopTwinWatcher,
  twinStatus,
  undoActions,
  writeTwinConfig,
  type TwinConfig,
} from "@/lib/twin";
import { expandPath } from "@/lib/config";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { daemonStatus } from "@/lib/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view === "actions") {
      return Response.json({ actions: recentActions(Number(url.searchParams.get("limit")) || 60) });
    }

    const [config, observers, proposals] = await Promise.all([
      readTwinConfig(),
      readObservers(),
      pendingProposals(8),
    ]);

    return Response.json({
      config,
      status: twinStatus(),
      proposals,
      automations: listAutomations(),
      actions: recentActions(20),
      enabled: observers.observers.twin.enabled,
      running: mayObserve("twin", observers),
      blockedBecause: whyNot("twin", observers),
      jobs: daemonStatus().jobs.filter((job) => job.observer === "twin"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<TwinConfig>;
    const current = await readTwinConfig();
    await writeTwinConfig({ ...current, ...body });
    /* The watcher follows the config immediately. Deferring it to the next tick
       would mean adding a folder and seeing nothing happen for ten minutes,
       which reads as broken. */
    if (mayObserve("twin")) await startTwinWatcher();
    return Response.json({ config: await readTwinConfig(), status: twinStatus() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      path?: string;
      ids?: number[];
      enabled?: boolean;
      dryRun?: boolean;
      name?: string;
    };

    switch (body.action) {
      case "watch": {
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const root = expandPath(body.path);
        const stat = await fs.stat(root).catch(() => null);
        if (!stat) return fail(new Error(`Nothing exists at ${root}`));
        if (!stat.isDirectory()) return fail(new Error(`${root} is a file, not a folder.`));
        const config = await readTwinConfig();
        if (!config.watchRoots.includes(root)) {
          await writeTwinConfig({ ...config, watchRoots: [...config.watchRoots, root] });
        }
        if (mayObserve("twin")) await startTwinWatcher();
        return Response.json({ config: await readTwinConfig(), status: twinStatus() });
      }
      case "unwatch": {
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const config = await readTwinConfig();
        await writeTwinConfig({
          ...config,
          watchRoots: config.watchRoots.filter((root) => root !== body.path),
        });
        await startTwinWatcher();
        return Response.json({ config: await readTwinConfig(), status: twinStatus() });
      }
      case "mine": {
        if (!mayObserve("twin")) {
          return fail(new Error(whyNot("twin", await readObservers()) ?? "Twin is off."), 403);
        }
        const mined = minePatterns(await readTwinConfig());
        return Response.json({ ...mined, proposals: await pendingProposals(8), status: twinStatus() });
      }
      case "accept": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        const automation = await acceptPattern(body.id);
        if (!automation) return fail(new Error("That pattern cannot become an automation."));
        return Response.json({ automation, automations: listAutomations(), proposals: await pendingProposals(8) });
      }
      case "dismiss": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        dismissPattern(body.id);
        return Response.json({ proposals: await pendingProposals(8) });
      }
      case "set": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        const automation = setAutomation(body.id, {
          enabled: body.enabled,
          dryRun: body.dryRun,
          name: body.name,
        });
        if (!automation) return fail(new Error("No such automation."), 404);
        return Response.json({ automation, automations: listAutomations() });
      }
      case "run": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        /*
         * `force` runs a disabled rule, which is what the preview button does.
         * It is safe because a disabled rule is also in dry-run by default —
         * and if it is not, the caller asked for it explicitly by pressing a
         * button labelled with what it will do.
         */
        const result = await runAutomation(body.id, { force: true });
        return Response.json({ ...result, actions: recentActions(20), status: twinStatus() });
      }
      case "delete": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        return Response.json({ removed: deleteAutomation(body.id), automations: listAutomations() });
      }
      case "undo": {
        if (!Array.isArray(body.ids) || !body.ids.length) return fail(new Error("`ids` is required."));
        const ids = body.ids.filter((id): id is number => Number.isInteger(id)).slice(0, 500);
        const result = await undoActions(ids);
        return Response.json({ ...result, actions: recentActions(40) });
      }
      case "forget":
        await forgetTwin();
        return Response.json({ ok: true, status: twinStatus() });
      case "stop":
        await stopTwinWatcher();
        return Response.json({ ok: true, status: twinStatus() });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    return fail(error);
  }
}
