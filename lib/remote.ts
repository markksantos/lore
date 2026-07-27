import crypto from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Paired remote access — the honest answer to "can I read my wiki on my phone".
 *
 * The wiki is a folder on this computer. A phone cannot read that folder. The
 * only truthful way to get it onto a phone is to let the phone talk to the
 * computer that holds it, over the local network, while that computer is awake.
 * There is no cloud here and nothing syncs.
 *
 * ---------------------------------------------------------------- what this is
 *
 * Lore normally binds 127.0.0.1 and refuses any request whose Host is not
 * loopback, because a filesystem-reading app on 0.0.0.0 hands the whole disk to
 * everyone on the wifi. Remote access is a door in that wall. So it is built
 * the way a door should be:
 *
 *   - OFF until the user turns it on. No token exists until then.
 *   - Turning it on mints 32 bytes from crypto.randomBytes, stored 0600 in
 *     ~/.lore/remote.json. Every request must carry it.
 *   - Comparison is constant-time. Failures are rate-limited per source IP.
 *   - The token is displayed only in the local UI, never returned to a caller
 *     that could be remote.
 *
 * -------------------------------------------------------- what this is NOT
 *
 * This is plain HTTP over a local network. It protects against a stranger on
 * the same wifi finding the port and guessing their way in — that is a real
 * threat in a cafe or a shared flat, and it is the threat this stops.
 *
 * It does NOT protect the traffic itself. Anyone who can already read packets
 * on that network — the router's owner, someone running a hostile access point,
 * anyone with the wifi password on an open network — can read every page you
 * load and lift the token out of the URL as it goes past. There is no TLS here,
 * because a self-signed certificate on a LAN IP trains people to click through
 * certificate warnings, which is worse than the problem it solves.
 *
 * Use it on a network you control. Do not use it on hotel or airport wifi.
 *
 * ------------------------------------------------- why the port is still shut
 *
 * Nothing in this repository binds anything but 127.0.0.1 — `npm run dev`,
 * `npm start` and electron/main.js all pass loopback explicitly. Turning this
 * switch on therefore mints a token and authorises a device, but no packet from
 * a phone can reach the socket, and `reachableOnLan` below reports that honestly
 * rather than letting the UI promise a connection that cannot happen.
 *
 * That gap is deliberate and must not be closed by simply passing 0.0.0.0.
 * proxy.ts and app/api/remote/route.ts decide "is this caller local?" from the
 * Host header, and a caller who can open the socket writes that header himself:
 * `Host: localhost` walks straight past the token check and past the reveal
 * endpoint that hands out the secret. Next is no help — it fills
 * `x-forwarded-for` from the socket only when the client did not supply one, so
 * that is forgeable too. While the bind is loopback none of this is reachable.
 * Opening the port needs a peer address established below Next (the process
 * that owns the listening socket) and the Host checks replaced with it. Until
 * that exists, this feature stays paired-but-unreachable on purpose.
 */

const DIR = path.join(os.homedir(), ".lore");
const FILE = path.join(DIR, "remote.json");

/** The port `npm run dev` and `npm start` bind. Used when nobody says otherwise. */
const DEFAULT_PORT = 4646;

export type RemoteConfig = {
  enabled: boolean;
  token: string | null;
  port: number;
  pairedAt: number | null;
};

const OFF: RemoteConfig = {
  enabled: false,
  token: null,
  port: DEFAULT_PORT,
  pairedAt: null,
};

/**
 * A token is 32 random bytes, base64url so it survives being a query parameter
 * and being read off a screen without percent-encoding surprises.
 */
function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function validPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536
    ? value
    : DEFAULT_PORT;
}

/**
 * Coerce whatever is on disk into a config we are willing to act on.
 *
 * `enabled` is deliberately ANDed with the presence of a token: a file that
 * says enabled but carries no secret would otherwise describe a door that is
 * open and unlocked. Hand-editing the file cannot produce that state.
 */
function normalise(raw: unknown): RemoteConfig {
  if (typeof raw !== "object" || raw === null) return { ...OFF };
  const value = raw as Record<string, unknown>;
  const token =
    typeof value.token === "string" && value.token.length >= 32 ? value.token : null;
  return {
    enabled: value.enabled === true && token !== null,
    token,
    port: validPort(value.port),
    pairedAt: typeof value.pairedAt === "number" ? value.pairedAt : null,
  };
}

/**
 * Synchronous read for verifyToken, which sits on the request path and cannot
 * await. Nothing is cached: the file is a hundred bytes, and a cache would mean
 * a rotated token kept admitting revoked devices for as long as the cache
 * lived. Revocation has to be immediate to mean anything.
 */
function readSync(): RemoteConfig {
  try {
    return normalise(JSON.parse(readFileSync(FILE, "utf8")));
  } catch {
    return { ...OFF };
  }
}

export async function readRemoteConfig(): Promise<RemoteConfig> {
  try {
    return normalise(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return { ...OFF };
  }
}

async function write(config: RemoteConfig): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  // The `mode` option is masked by the process umask and is ignored entirely
  // when the file already exists, so the explicit chmod is the one that
  // actually guarantees 0600 on every write.
  await fs.writeFile(FILE, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(FILE, 0o600);
}

/**
 * Turn remote access on. Enabling an already-enabled pairing keeps the existing
 * token so phones that are already paired stay paired — rotateToken is the
 * deliberate way to break them, and it should be the only way.
 */
export async function enableRemote(port?: number): Promise<RemoteConfig> {
  const current = await readRemoteConfig();
  const config: RemoteConfig = {
    enabled: true,
    token: current.token ?? newToken(),
    port: port === undefined ? current.port : validPort(port),
    pairedAt: current.pairedAt ?? Date.now(),
  };
  await write(config);
  return config;
}

/**
 * Turn it off, and forget the secret while doing so. Keeping the token across
 * an off/on cycle would mean flipping the switch back on silently re-admits
 * every device that was ever paired, including the one the user turned this off
 * because of.
 */
export async function disableRemote(): Promise<void> {
  const current = await readRemoteConfig();
  await write({ ...OFF, port: current.port });
}

/** New secret, same switch position. Every paired device is now unpaired. */
export async function rotateToken(): Promise<RemoteConfig> {
  const current = await readRemoteConfig();
  const config: RemoteConfig = {
    enabled: current.enabled,
    token: newToken(),
    port: current.port,
    pairedAt: Date.now(),
  };
  await write(config);
  return config;
}

/**
 * Constant-time token check.
 *
 * Both sides are hashed to a fixed 32 bytes before comparing. That is not for
 * secrecy — it is so timingSafeEqual always gets equal lengths, since it throws
 * on a mismatch and an early length check would leak the token's length through
 * response timing.
 */
export function verifyToken(supplied: string | null): boolean {
  const config = readSync();
  if (!config.enabled || config.token === null || !supplied) return false;
  const expected = crypto.createHash("sha256").update(config.token, "utf8").digest();
  const offered = crypto.createHash("sha256").update(supplied, "utf8").digest();
  return crypto.timingSafeEqual(expected, offered);
}

/* ------------------------------------------------------------- rate limiting
 * A 32-byte token is not guessable, but the limiter is what makes that claim
 * true in practice rather than in theory: without it a script on the LAN can
 * fire requests until something sticks, and every one of those attempts is
 * free. Ten misses buys a quarter of an hour of silence.
 *
 * Honest limitation: middleware sees the peer address through the
 * `x-forwarded-for` header, which a caller can set themselves. An attacker who
 * rotates that header gets a fresh bucket each time. The global backstop below
 * exists precisely for that case — it counts failures regardless of who claims
 * to have made them, and shuts remote auth entirely when the total is
 * obviously an attack. Loopback is exempt from both, so a lockout can never
 * lock the owner out of their own machine.
 */

const WINDOW_MS = 5 * 60_000;
const MAX_FAILURES = 10;
const BLOCK_MS = 15 * 60_000;

/** Failures from every source combined. Six times the per-IP allowance. */
const GLOBAL_MAX_FAILURES = 60;

type Attempts = { failures: number[]; blockedUntil: number };

const attempts = new Map<string, Attempts>();
let globalFailures: number[] = [];
let globalBlockedUntil = 0;

function isLoopbackAddress(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  return bare === "127.0.0.1" || bare === "::1" || bare.startsWith("127.");
}

/** Drop buckets that hold neither a live failure nor a live block. */
function sweep(now: number): void {
  for (const [ip, entry] of attempts) {
    const live = entry.failures.some((at) => now - at < WINDOW_MS);
    if (!live && entry.blockedUntil <= now) attempts.delete(ip);
  }
}

export function noteAuthFailure(ip: string): void {
  if (isLoopbackAddress(ip)) return;
  const now = Date.now();
  sweep(now);

  const entry = attempts.get(ip) ?? { failures: [], blockedUntil: 0 };
  entry.failures = entry.failures.filter((at) => now - at < WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.blockedUntil = now + BLOCK_MS;
    // Cleared so the block expiring does not immediately re-trip on the same
    // failures it was already punishment for.
    entry.failures = [];
  }
  attempts.set(ip, entry);

  globalFailures = globalFailures.filter((at) => now - at < WINDOW_MS);
  globalFailures.push(now);
  if (globalFailures.length >= GLOBAL_MAX_FAILURES) {
    globalBlockedUntil = now + BLOCK_MS;
    globalFailures = [];
  }
}

export function isRateLimited(ip: string): boolean {
  if (isLoopbackAddress(ip)) return false;
  const now = Date.now();
  if (globalBlockedUntil > now) return true;
  const entry = attempts.get(ip);
  return entry !== undefined && entry.blockedUntil > now;
}

/* ------------------------------------------------------------------ addresses */

/** 10/8, 172.16/12, 192.168/16 — the ranges a home or office LAN actually uses. */
function isPrivate(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * The addresses a phone could reach this machine on.
 *
 * IPv4 only. The address ends up typed by hand or encoded into a QR code, and
 * an IPv6 literal is neither readable nor dependably routable across a consumer
 * router. Private ranges sort first because those are the ones that will work
 * from the sofa; a public address, if any shows up, is listed last and is
 * almost certainly not what the user wants to hand out.
 */
/**
 * Is this machine actually answering on a network address, or only on itself?
 *
 * Asked by opening a TCP connection to our own LAN address and seeing whether
 * anything is there. A server bound to 0.0.0.0 accepts it; a server bound to
 * 127.0.0.1 refuses it, because the LAN address is not one of its listeners.
 * That is the whole difference between a pairing link that works and one that
 * times out, and it is the reason the UI can say which of the two it is instead
 * of asking the user to restart and hope.
 */
export async function reachableOnLan(port: number, address?: string): Promise<boolean> {
  const target = address ?? (await localAddresses())[0];
  if (!target) return false;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    // Generous enough for a loopback-speed answer, short enough that the
    // settings screen never visibly waits on it. A silent drop (a firewall
    // swallowing the SYN) is a failure for our purposes too: the phone would
    // hang exactly the same way.
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, target);
  });
}

export async function localAddresses(): Promise<string[]> {
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (!found.includes(net.address)) found.push(net.address);
    }
  }
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
