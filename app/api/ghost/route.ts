import { fail } from "@/lib/server";
import {
  captureFrame,
  dayDigest,
  dayKey,
  describePending,
  forgetEverything,
  forgetFrame,
  forgetOldFrames,
  forgetRange,
  framesAround,
  ghostModel,
  ghostStatus,
  readGhostConfig,
  writeGhostConfig,
  type GhostConfig,
} from "@/lib/ghost";
import { detectCapabilities } from "@/lib/capabilities";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { daemonStatus, runNow } from "@/lib/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ghost's control surface.
 *
 * One route rather than six, because every one of these is a variation on the
 * same question — what has Ghost got, and what should it do next — and the UI
 * needs the status alongside the answer to nearly all of them.
 *
 * Every mutating action re-checks consent through `mayObserve`. The daemon is
 * gated, but this is the door a person can knock on directly, and a gate that
 * only covers the timer is not a gate.
 */

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view === "digest") {
      const day = url.searchParams.get("day") || dayKey(Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(new Error("Bad day."));
      return Response.json(await dayDigest(day, url.searchParams.get("force") === "1"));
    }

    if (view === "around") {
      const at = Number(url.searchParams.get("at"));
      if (!Number.isFinite(at)) return fail(new Error("`at` must be a timestamp."));
      const span = Math.min(6 * 3_600_000, Math.max(60_000, Number(url.searchParams.get("span")) || 30 * 60_000));
      return Response.json({ frames: framesAround(at, span) });
    }

    const [config, status, capabilities, observers] = await Promise.all([
      readGhostConfig(),
      ghostStatus(),
      detectCapabilities(),
      readObservers(),
    ]);

    return Response.json({
      config,
      status,
      capabilities: {
        screenCapture: capabilities.screenCapture,
        windowTitles: capabilities.windowTitles,
        vision: capabilities.vision,
        storage: capabilities.storage,
        desktop: capabilities.desktop,
        platform: capabilities.platform,
      },
      enabled: observers.observers.ghost.enabled,
      running: mayObserve("ghost", observers),
      blockedBecause: whyNot("ghost", observers),
      model: await ghostModel(config),
      jobs: daemonStatus().jobs.filter((job) => job.observer === "ghost"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<GhostConfig>;
    const current = await readGhostConfig();
    /* Merged, then re-read through readGhostConfig's clamps: a settings screen
       that can post `everySeconds: 0` should not be the thing that decides
       whether the clamp applies. */
    await writeGhostConfig({ ...current, ...body });
    return Response.json({ config: await readGhostConfig() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: number;
      from?: number;
      to?: number;
    };

    switch (body.action) {
      case "capture": {
        if (!mayObserve("ghost")) {
          return fail(new Error(whyNot("ghost", await readObservers()) ?? "Ghost is off."), 403);
        }
        return Response.json(await captureFrame());
      }
      case "describe": {
        if (!mayObserve("ghost")) {
          return fail(new Error(whyNot("ghost", await readObservers()) ?? "Ghost is off."), 403);
        }
        return Response.json(await describePending(6));
      }
      case "run": {
        /* The daemon's own tick, on demand. Distinct from "capture" because it
           is the whole cycle — capture, then describe — which is what someone
           who just switched Ghost on wants to see happen. */
        const captured = await runNow("ghost:capture");
        const described = await runNow("ghost:describe");
        return Response.json({ captured, described, status: await ghostStatus() });
      }
      case "prune":
        return Response.json({ removed: await forgetOldFrames() });
      case "forget-frame": {
        if (!Number.isFinite(body.id)) return fail(new Error("`id` is required."));
        return Response.json({ removed: (await forgetFrame(Number(body.id))) ? 1 : 0 });
      }
      case "forget-range": {
        const from = Number(body.from);
        const to = Number(body.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
          return fail(new Error("`from` and `to` must be timestamps."));
        }
        return Response.json({ removed: await forgetRange(from, to) });
      }
      case "forget-all":
        await forgetEverything();
        return Response.json({ ok: true });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    return fail(error);
  }
}
