import { fail } from "@/lib/server";
import {
  briefFor,
  currentCards,
  forgetProphet,
  markNotified,
  pendingNotifications,
  prophetStatus,
  readProphetConfig,
  respond,
  think,
  writeProphetConfig,
  type ProphetConfig,
} from "@/lib/prophet";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { daemonStatus } from "@/lib/daemon";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    if (url.searchParams.get("view") === "notifications") {
      /*
       * Polled by the desktop shell, which posts the notifications and then
       * marks them. Deliberately a separate endpoint from the card list: the
       * shell asks every minute and must not pay for the whole board, and
       * opening the app should not silently consume the notification queue.
       */
      return Response.json({ cards: await pendingNotifications() });
    }

    const [config, status, cards, observers] = await Promise.all([
      readProphetConfig(),
      prophetStatus(),
      currentCards(),
      readObservers(),
    ]);

    return Response.json({
      config,
      status,
      cards,
      enabled: observers.observers.prophet.enabled,
      running: mayObserve("prophet", observers),
      blockedBecause: whyNot("prophet", observers),
      jobs: daemonStatus().jobs.filter((job) => job.observer === "prophet"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<ProphetConfig>;
    const current = await readProphetConfig();
    await writeProphetConfig({ ...current, ...body, kinds: { ...current.kinds, ...(body.kinds ?? {}) } });
    return Response.json({ config: await readProphetConfig(), cards: await currentCards() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      response?: "seen" | "snooze" | "dismiss" | "acted";
      minutes?: number;
      ids?: string[];
    };

    switch (body.action) {
      case "think": {
        if (!mayObserve("prophet")) {
          return fail(new Error(whyNot("prophet", await readObservers()) ?? "Prophet is off."), 403);
        }
        const result = await think();
        return Response.json({ ...result, cards: await currentCards(), status: await prophetStatus() });
      }
      case "respond": {
        if (typeof body.id !== "string" || !body.response) {
          return fail(new Error("`id` and `response` are required."));
        }
        const card = respond(body.id, body.response, body.minutes ?? 60);
        if (!card) return fail(new Error("No such card."), 404);
        return Response.json({ card, cards: await currentCards() });
      }
      case "brief": {
        if (typeof body.id !== "string") return fail(new Error("`id` is required."));
        const result = await askGate.run(() => briefFor(body.id!));
        if (!result) return fail(new Error("No such card."), 404);
        return Response.json(result);
      }
      case "notified": {
        if (!Array.isArray(body.ids)) return fail(new Error("`ids` is required."));
        markNotified(body.ids.filter((id): id is string => typeof id === "string"));
        return Response.json({ ok: true });
      }
      case "forget":
        await forgetProphet();
        return Response.json({ ok: true, status: await prophetStatus() });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}
