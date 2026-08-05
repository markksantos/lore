import { promises as fs } from "node:fs";
import { fail } from "@/lib/server";
import {
  draft,
  forgetUnderstudy,
  learnVoice,
  readProfile,
  readUnderstudyConfig,
  rebuildProfile,
  understudyStatus,
  voiceBrief,
  writeUnderstudyConfig,
  type UnderstudyConfig,
} from "@/lib/understudy";
import { expandPath } from "@/lib/config";
import { mayObserve, readObservers, whyNot } from "@/lib/observers";
import { detectCapabilities } from "@/lib/capabilities";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const [config, status, observers, capabilities] = await Promise.all([
      readUnderstudyConfig(),
      understudyStatus(),
      readObservers(),
      detectCapabilities(),
    ]);
    const profile = readProfile();

    return Response.json({
      config,
      status,
      profile,
      /* The same words the model will be given. Showing it is the difference
         between "trust the voice model" and "here is exactly what it was told
         about you, and you can check it against yourself." */
      brief: profile?.overall.samples ? voiceBrief(profile.overall) : null,
      localModel: capabilities.localModel,
      enabled: observers.observers.understudy.enabled,
      running: mayObserve("understudy", observers),
      blockedBecause: whyNot("understudy", observers),
      audience: url.searchParams.get("audience"),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<UnderstudyConfig>;
    const current = await readUnderstudyConfig();
    await writeUnderstudyConfig({
      ...current,
      ...body,
      sources: { ...current.sources, ...(body.sources ?? {}) },
    });
    return Response.json({ config: await readUnderstudyConfig() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      brief?: string;
      audience?: string | null;
      path?: string;
    };

    switch (body.action) {
      case "learn": {
        if (!mayObserve("understudy")) {
          return fail(
            new Error(whyNot("understudy", await readObservers()) ?? "Understudy is off."),
            403,
          );
        }
        const result = await learnVoice();
        return Response.json({ ...result, status: await understudyStatus() });
      }
      case "rebuild":
        return Response.json({ profile: rebuildProfile(), status: await understudyStatus() });
      case "draft": {
        if (typeof body.brief !== "string" || !body.brief.trim()) {
          return fail(new Error("Say what to write."));
        }
        /*
         * Drafting is not gated on the observer switch.
         *
         * The switch controls whether Understudy reads more of your writing.
         * Once it has a profile, using that profile is using your own data —
         * and pausing observation to stop it reading new mail should not also
         * take away the ability to write.
         */
        const audience = typeof body.audience === "string" && body.audience ? body.audience : null;
        return Response.json(await askGate.run(() => draft(body.brief!.trim(), audience)));
      }
      case "add-folder": {
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const folder = expandPath(body.path);
        const stat = await fs.stat(folder).catch(() => null);
        if (!stat) return fail(new Error(`Nothing exists at ${folder}`));
        if (!stat.isDirectory()) return fail(new Error(`${folder} is a file, not a folder.`));
        const config = await readUnderstudyConfig();
        if (!config.folders.includes(folder)) {
          await writeUnderstudyConfig({ ...config, folders: [...config.folders, folder] });
        }
        return Response.json({ config: await readUnderstudyConfig() });
      }
      case "remove-folder": {
        if (typeof body.path !== "string") return fail(new Error("`path` is required."));
        const config = await readUnderstudyConfig();
        await writeUnderstudyConfig({
          ...config,
          folders: config.folders.filter((folder) => folder !== body.path),
        });
        return Response.json({ config: await readUnderstudyConfig() });
      }
      case "forget":
        await forgetUnderstudy();
        return Response.json({ ok: true, status: await understudyStatus() });
      default:
        return fail(new Error(`Unknown action ${body.action ?? "(none)"}.`));
    }
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}
