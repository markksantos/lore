import { fail, requireVault } from "@/lib/server";
import { health } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vault = await requireVault();
    return Response.json(await health(vault.root));
  } catch (error) {
    return fail(error, 409);
  }
}
