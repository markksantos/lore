import { fail, requireVault } from "@/lib/server";
import {
  DEFAULT_LISTEN,
  INBOX_DIR,
  ensureListener,
  lastSweepInfo,
  readListenConfig,
  runSweep,
  writeListenConfig,
  type ListenConfig,
} from "@/lib/listen";
import { detectOllama } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const port = () => Number(process.env.PORT) || 4646;

/** GET — config, model availability, and what the last sweep did. */
export async function GET() {
  try {
    const vault = await requireVault();
    const config = await readListenConfig(vault.root);
    // Keep the scheduler honest with the stored config on every read; this is
    // also what starts it after a server restart.
    await ensureListener(vault.root, port());
    const detection = await detectOllama().catch(() => null);
    return Response.json({
      config,
      inbox: INBOX_DIR,
      modelReady: Boolean(detection?.running && detection.models.length),
      lastSweep: lastSweepInfo(),
    });
  } catch (error) {
    return fail(error);
  }
}

/** POST — update config, or run a sweep right now. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as Partial<ListenConfig> & {
      action?: "sweep";
    };

    if (body.action === "sweep") {
      await ensureListener(vault.root, port());
      const result = await runSweep(vault.root, port());
      return Response.json({ result });
    }

    const current = await readListenConfig(vault.root);
    const next: ListenConfig = {
      enabled: body.enabled ?? current.enabled,
      sources: { ...DEFAULT_LISTEN.sources, ...current.sources, ...(body.sources ?? {}) },
      quietMinutes: Math.max(1, Number(body.quietMinutes) || current.quietMinutes),
    };
    await writeListenConfig(vault.root, next);
    await ensureListener(vault.root, port());
    return Response.json({ config: next });
  } catch (error) {
    return fail(error);
  }
}
