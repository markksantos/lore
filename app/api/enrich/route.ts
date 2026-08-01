import { fail, requireVault } from "@/lib/server";
import {
  DEFAULT_ENRICH,
  ensureEnricher,
  lastEnrichInfo,
  readEnrichConfig,
  runEnrich,
  writeEnrichConfig,
  type EnrichConfig,
} from "@/lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const port = () => Number(process.env.PORT) || 4646;

export async function GET() {
  try {
    const vault = await requireVault();
    await ensureEnricher(vault.root, port());
    return Response.json({
      config: await readEnrichConfig(vault.root),
      lastRun: lastEnrichInfo(),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as Partial<EnrichConfig> & {
      action?: "sweep";
    };
    if (body.action === "sweep") {
      await ensureEnricher(vault.root, port());
      return Response.json({ result: await runEnrich(vault.root, port()) });
    }
    const current = await readEnrichConfig(vault.root);
    const next: EnrichConfig = {
      enabled: body.enabled ?? current.enabled,
      youtube: body.youtube ?? current.youtube,
      articles: body.articles ?? current.articles,
      dwellSeconds: Math.max(20, Number(body.dwellSeconds) || current.dwellSeconds),
    };
    await writeEnrichConfig(vault.root, next);
    await ensureEnricher(vault.root, port());
    return Response.json({ config: next });
  } catch (error) {
    return fail(error);
  }
}
