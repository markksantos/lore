import { fail } from "@/lib/server";
import {
  OBSERVER_IDS,
  OBSERVER_LABEL,
  OBSERVER_READS,
  pauseAll,
  readConsentLog,
  readObservers,
  setObserver,
  setQuietHours,
  whyNot,
  type ObserverId,
} from "@/lib/observers";
import { daemonStatus, runNow } from "@/lib/daemon";
import { detectCapabilities, forgetCapabilities } from "@/lib/capabilities";
import { wireObservers } from "@/lib/observer-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The consent screen's endpoint — one place that answers "what is watching me".
 *
 * Deliberately assembled here rather than left to the client to stitch from six
 * per-feature calls. A privacy summary made of six separate requests is one
 * where a failed request looks like "nothing is running", which is the most
 * dangerous wrong answer this screen can give.
 */

const isObserver = (value: unknown): value is ObserverId =>
  typeof value === "string" && (OBSERVER_IDS as string[]).includes(value);

export async function GET() {
  try {
    /* Idempotent, and here as a safety net: if instrumentation did not run —
       an unusual dev restart, a host that skips it — opening this screen is
       what brings the loop up rather than leaving every observer silently
       dead with its switch on. */
    wireObservers();

    const [config, capabilities] = await Promise.all([readObservers(), detectCapabilities()]);
    const status = daemonStatus();

    return Response.json({
      observers: OBSERVER_IDS.map((id) => ({
        id,
        label: OBSERVER_LABEL[id],
        reads: OBSERVER_READS[id],
        enabled: config.observers[id].enabled,
        enabledAt: config.observers[id].enabledAt,
        blockedBecause: whyNot(id, config),
        jobs: status.jobs.filter((job) => job.observer === id),
      })),
      pausedUntil: config.pausedUntil,
      quietHours: config.quietHours,
      daemon: { started: status.started, jobs: status.jobs.length },
      capabilities,
      log: await readConsentLog(40),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      observer?: unknown;
      enabled?: boolean;
      minutes?: number;
      from?: number;
      to?: number;
      job?: string;
    };

    switch (body.action) {
      case "set": {
        if (!isObserver(body.observer)) return fail(new Error("Unknown observer."));
        const config = await setObserver(body.observer, body.enabled === true);
        /* Twin's watcher is a live filesystem handle rather than a timer, so
           turning it off has to actually close it — a paused job that stops
           being scheduled would leave the watcher attached and still
           recording. */
        if (body.observer === "twin" && body.enabled !== true) {
          const { stopTwinWatcher } = await import("@/lib/twin");
          await stopTwinWatcher();
        }
        return Response.json({ config });
      }
      case "pause":
        return Response.json({ config: await pauseAll(Math.max(0, Number(body.minutes) || 0)) });
      case "quiet-hours": {
        const from = Number(body.from);
        const to = Number(body.to);
        const hours =
          Number.isInteger(from) && Number.isInteger(to) && from !== to ? { from, to } : null;
        return Response.json({ config: await setQuietHours(hours) });
      }
      case "run": {
        if (typeof body.job !== "string") return fail(new Error("`job` is required."));
        return Response.json(await runNow(body.job));
      }
      case "recheck": {
        /* After granting a macOS permission. The probes are cached for twenty
           seconds, and a user who has just been to System Settings should not
           have to wait out a cache to see it took. */
        forgetCapabilities();
        return Response.json({ capabilities: await detectCapabilities(true) });
      }
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    return fail(error);
  }
}
