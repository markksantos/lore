import { fail, loadVaultIndex } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    return Response.json(await loadVaultIndex(force));
  } catch (error) {
    return fail(error, 409);
  }
}
