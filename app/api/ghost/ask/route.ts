import { fail } from "@/lib/server";
import { recall } from "@/lib/ghost";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";
import { readObservers } from "@/lib/observers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask Ghost what you were doing.
 *
 * Behind the same inference gate as Ask, because it is the same scarce
 * resource: one local model, and two questions at once means both take twice as
 * long rather than either being early.
 *
 * Recall reads what has already been captured, so it deliberately does NOT
 * check `mayObserve`. Turning Ghost off should stop it watching, not erase your
 * ability to ask about the week it did watch — the button for that is "forget
 * everything", and it is a different button on purpose.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: unknown };
    if (typeof body.question !== "string") return fail(new Error("`question` must be a string."));
    const question = body.question.trim();
    if (!question) return fail(new Error("Ask something."));

    const observers = await readObservers();
    const result = await askGate.run(() => recall(question));

    return Response.json({
      ...result,
      /* The reader has to be able to tell "Ghost saw nothing" from "Ghost was
         never turned on", which look identical in an empty result list. */
      everEnabled: observers.observers.ghost.enabledAt !== null,
    });
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}
