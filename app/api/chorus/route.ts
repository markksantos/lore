import { fail } from "@/lib/server";
import {
  forgetDebate,
  listDebates,
  readChorusConfig,
  readDebate,
  runChorus,
  suggestPanel,
  writeChorusConfig,
  type ChorusConfig,
  type ChorusEvent,
} from "@/lib/chorus";
import {
  DEFAULT_MODEL,
  PROVIDER_LABEL,
  providerAvailability,
  saveKey,
  type ProviderId,
} from "@/lib/chorus-providers";
import { detectOllama } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isProvider = (value: unknown): value is ProviderId =>
  typeof value === "string" && value in PROVIDER_LABEL;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view === "debate") {
      const id = url.searchParams.get("id");
      if (!id) return fail(new Error("`id` is required."));
      const debate = readDebate(id);
      if (!debate) return fail(new Error("No such debate."), 404);
      return Response.json({ debate });
    }

    if (view === "history") {
      return Response.json({ debates: listDebates(Number(url.searchParams.get("limit")) || 30) });
    }

    const [config, providers, ollama] = await Promise.all([
      readChorusConfig(),
      providerAvailability(),
      detectOllama().catch(() => ({ running: false, models: [], error: null })),
    ]);

    return Response.json({
      config,
      /* Booleans and model names only. No key, no prefix, no length — there is
         no field in this response that narrows a secret by one bit. */
      providers: (Object.keys(PROVIDER_LABEL) as ProviderId[]).map((provider) => ({
        id: provider,
        label: PROVIDER_LABEL[provider],
        configured: providers[provider].configured,
        fromEnv: providers[provider].fromEnv,
        defaultModel: DEFAULT_MODEL[provider],
      })),
      localModels: ollama.models.map((model) => model.name),
      suggestion: await suggestPanel(),
      debates: listDebates(10),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<ChorusConfig>;
    const current = await readChorusConfig();
    await writeChorusConfig({ ...current, ...body });
    return Response.json({ config: await readChorusConfig() });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Convene the panel, streamed.
 *
 * Server-sent events rather than a single JSON reply, because the debate takes
 * a minute or two and watching it happen is most of the value. Every frame is
 * one `ChorusEvent`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      question?: string;
      provider?: unknown;
      key?: string | null;
      id?: string;
    };

    if (body.action === "key") {
      /*
       * Accepted and never echoed. The response says which providers are
       * configured and nothing about their values — not a prefix, not a
       * length, not a masked form. A key that reaches a screen has left the
       * machine, and this app is watched over somebody's shoulder.
       */
      if (!isProvider(body.provider)) return fail(new Error("Unknown provider."));
      if (body.provider === "ollama") return fail(new Error("The local runtime needs no key."));
      const key = typeof body.key === "string" ? body.key.trim() : "";
      await saveKey(body.provider, key || null);
      return Response.json({ providers: await providerAvailability() });
    }

    if (body.action === "forget") {
      if (typeof body.id !== "string") return fail(new Error("`id` is required."));
      return Response.json({ removed: forgetDebate(body.id) });
    }

    const question = (body.question ?? "").trim();
    if (!question) return fail(new Error("Ask something."));
    if (question.length > 20_000) return fail(new Error("That question is too long."));

    const config = await readChorusConfig();
    if (!config.panelists.length) {
      return fail(
        new Error(
          "No panelists are configured. Add an API key, or install a second local model, and Chorus will assemble a panel.",
        ),
      );
    }

    const encoder = new TextEncoder();
    /*
     * The debate must survive its own reader.
     *
     * A closed tab makes `enqueue` throw, and a throw inside an async `start`
     * is an unhandled rejection — which on Node's defaults ends the process,
     * and the process is also the user's wiki. So every send is caught and
     * `cancel` aborts the provider calls rather than leaving three frontier
     * models generating for nobody.
     */
    const gone = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: ChorusEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            open = false;
            gone.abort();
          }
        };

        try {
          await runChorus(question, config, send, gone.signal);
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "The debate failed.",
          });
        }
        try {
          controller.close();
        } catch {
          /* Already closed by the reader going away. */
        }
      },
      cancel() {
        gone.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
