import { fail } from "@/lib/server";
import {
  disableRemote,
  enableRemote,
  localAddresses,
  readRemoteConfig,
  reachableOnLan,
  rotateToken,
  type RemoteConfig,
} from "@/lib/remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The control surface for remote access.
 *
 * Everything that changes the pairing, and the one call that hands out the
 * token, is refused unless the request arrives on loopback. A paired phone is
 * allowed to read the wiki; it is not allowed to mint a new secret, reveal the
 * current one, or switch remote access off and lock the owner out from across
 * the room. Control stays on the machine that owns the files.
 */

/**
 * Mirrors the loopback test in proxy.ts, which owns the app-wide boundary. The
 * duplication is deliberate — this route must not depend on middleware having
 * run, since middleware is the layer that lets token-authenticated remote
 * requests through, and a paired device that gets past it must still not reach
 * the controls below.
 *
 * Like the copy in proxy.ts this reads a header the caller writes, so it is
 * only meaningful while the socket is bound to loopback. See lib/remote.ts for
 * why that bind is the real boundary and why it has not been widened.
 */
function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "::1" ||
    name === "0.0.0.0" ||
    name.endsWith(".localhost")
  );
}

/**
 * The public shape of the config. The token is replaced by a boolean: a caller
 * needs to know whether a secret exists to render "on" versus "off", and never
 * needs the secret itself from here.
 *
 * `listening` is measured, not assumed — a pairing link is only real if the
 * port answers on a network address, and the UI has no business claiming it
 * does without checking. It is measured whether or not the switch is on,
 * because the two interesting states are opposites: on and unreachable means
 * the link will not connect, and off but reachable means the port was opened by
 * hand and the machine is exposed. Both are things the user should be told.
 */
async function status(config: RemoteConfig) {
  const addresses = await localAddresses();
  return {
    enabled: config.enabled,
    port: config.port,
    pairedAt: config.pairedAt,
    hasToken: config.token !== null,
    addresses,
    urls: addresses.map((address) => `http://${address}:${config.port}`),
    listening: await reachableOnLan(config.port, addresses[0]),
  };
}

/** GET — current state and the LAN addresses this machine answers on. No token. */
export async function GET() {
  try {
    return Response.json(await status(await readRemoteConfig()));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    // Read the body before the loopback check so a malformed request from a
    // remote caller gets the same 403 as a well-formed one, rather than a 400
    // that confirms the endpoint parses input.
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      port?: number;
    };

    if (!isLoopbackHost(request.headers.get("host"))) {
      return Response.json(
        {
          error:
            "Remote access is configured from the computer that holds the wiki, not from a paired device.",
        },
        { status: 403 },
      );
    }

    switch (body.action) {
      case "enable":
        return Response.json(await status(await enableRemote(body.port)));

      case "disable":
        await disableRemote();
        return Response.json(await status(await readRemoteConfig()));

      case "rotate":
        return Response.json(await status(await rotateToken()));

      case "reveal": {
        const config = await readRemoteConfig();
        if (!config.enabled || config.token === null) {
          return fail(new Error("Remote access is off, so there is no token."), 409);
        }
        // The only response in the app that carries the secret. It has already
        // been proven loopback above; no-store keeps it out of any cache that
        // might otherwise hold it after the tab is closed.
        return Response.json(
          { token: config.token },
          { headers: { "cache-control": "no-store" } },
        );
      }

      default:
        return fail(new Error("Unknown action."));
    }
  } catch (error) {
    return fail(error);
  }
}
