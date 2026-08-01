import { fail, requireVault } from "@/lib/server";
import { markRead, readAlerts, unreadCount } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vault = await requireVault();
    const alerts = await readAlerts(vault.root);
    return Response.json({ alerts: alerts.slice(0, 100), unread: unreadCount(alerts) });
  } catch (error) {
    return fail(error);
  }
}

/** POST — mark everything up to now as seen. */
export async function POST() {
  try {
    const vault = await requireVault();
    await markRead(vault.root);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
