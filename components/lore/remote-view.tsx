"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Power,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { paletteVars } from "@/lib/palette";
import { cn, relativeTime } from "@/lib/utils";

/** What GET /api/remote returns. Deliberately never carries the token. */
type RemoteStatus = {
  enabled: boolean;
  port: number;
  pairedAt: number | null;
  hasToken: boolean;
  addresses: string[];
  urls: string[];
  /** Measured on the server: does the port actually answer on a network address? */
  listening: boolean;
};

/**
 * Remote access — reading this wiki on your phone.
 *
 * The wiki is a folder on this computer, so the phone has to talk to this
 * computer. That is the whole feature and the UI says so plainly: it works on
 * your network, while this machine is awake, and it stops working the moment
 * either of those stops being true. Anything vaguer would let someone believe
 * they had bought cloud sync.
 *
 * The token is fetched into this component and shown here because this
 * component only ever renders on the machine that owns the files — the reveal
 * endpoint refuses any request that did not arrive on loopback.
 */
export function RemoteView() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "enable" | "disable" | "rotate">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  /** Pull the token straight after any change that could have minted a new one. */
  const reveal = useCallback(async (next: RemoteStatus) => {
    if (!next.enabled) {
      setToken(null);
      return;
    }
    const response = await fetch("/api/remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reveal" }),
    });
    setToken(response.ok ? ((await response.json()) as { token: string }).token : null);
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/remote");
    if (!response.ok) return;
    const next = (await response.json()) as RemoteStatus;
    setStatus(next);
    await reveal(next);
  }, [reveal]);

  useEffect(() => {
    load();
  }, [load]);

  // Follow the machine's own addresses: a laptop that moves from ethernet to
  // wifi gets a different IP, and a selection pinned to the old one would show
  // a link that silently no longer works.
  useEffect(() => {
    if (!status) return;
    setAddress((current) =>
      current && status.addresses.includes(current) ? current : (status.addresses[0] ?? null),
    );
  }, [status]);

  async function act(action: "enable" | "disable" | "rotate") {
    setBusy(action);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          // The port the browser is talking to right now is the truth; the
          // stored default is only a guess about how Lore was started.
          port: Number(window.location.port) || undefined,
        }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "That did not work.");
        return;
      }
      const next = (await response.json()) as RemoteStatus;
      setStatus(next);
      await reveal(next);
    } finally {
      setBusy(null);
    }
  }

  // `lore_token` is the parameter proxy.ts reads on the way in, where it is
  // swapped for a cookie and stripped from the URL. The name is spelled out in
  // both files because this one is a client component and cannot import the
  // node-only module that owns the boundary; changing it here means changing it
  // there in the same commit.
  const pairUrl = useMemo(() => {
    if (!status?.enabled || !token || !address) return null;
    return `http://${address}:${status.port}/vault?lore_token=${token}`;
  }, [status, token, address]);

  const qr = useMemo(() => (pairUrl ? qrModules(pairUrl) : null), [pairUrl]);

  async function copy() {
    if (!pairUrl) return;
    try {
      await navigator.clipboard.writeText(pairUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser refused clipboard access — select the link and copy it by hand.");
    }
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Remote access
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Your wiki is a folder on this computer. To read it on your phone, the phone has to
          talk to this computer — so that is exactly what this does. It is not sync, and
          nothing is uploaded anywhere.
        </p>
      </header>

      {error ? (
        <p className="mb-5 rounded-xl border border-[var(--lore-danger)]/40 bg-[var(--lore-surface)] px-4 py-3 text-[13px] text-[var(--lore-danger)]">
          {error}
        </p>
      ) : null}

      {!status.enabled && status.listening ? (
        <p className="mb-5 flex items-start gap-2.5 rounded-xl border border-[var(--lore-danger)]/40 bg-[var(--lore-surface)] px-4 py-3 text-[13px] text-[var(--lore-text-secondary)]">
          <TriangleAlert size={15} className="mt-px shrink-0 text-[var(--lore-danger)]" />
          <span>
            Something started Lore listening on your whole network, not just on this
            computer. Remote access is off, so nothing here opened it — but Lore protects
            your files by only being reachable from this machine, and right now it is not.
            Quit Lore and start it normally.
          </span>
        </p>
      ) : null}

      {status.enabled ? (
        <OnState
          status={status}
          address={address}
          onAddress={setAddress}
          pairUrl={pairUrl}
          qr={qr}
          copied={copied}
          onCopy={copy}
          busy={busy}
          onAct={act}
        />
      ) : (
        <OffState busy={busy === "enable"} onEnable={() => act("enable")} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- off */

function OffState({ busy, onEnable }: { busy: boolean; onEnable: () => void }) {
  return (
    <>
      <section
        style={paletteVars(0)}
        className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4"
      >
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="pal-bar !h-5" />
          <span className="pal-title">What turning this on does</span>
        </h2>
        <ul className="pal-bullets t-body mt-2.5 space-y-1.5 text-[var(--lore-text-secondary)]">
          <li>Creates one long random password and stores it on this machine only.</li>
          <li>
            Lets any device on your network open your wiki, but only if it carries that
            password — a link, or the QR code shown here.
          </li>
          <li>Works while this computer is awake and on the same network. Nothing else.</li>
          <li>Turning it off again forgets the password and unpairs every device.</li>
          <li>
            One caveat, stated plainly: this build of Lore still only listens to itself, so
            turning this on sets the pairing up rather than opening the door. The next
            screen tells you whether the link can actually connect.
          </li>
        </ul>
      </section>

      <section
        style={paletteVars(2)}
        className="mt-4 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4"
      >
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="pal-bar !h-5" />
          <span className="pal-title">What it costs you</span>
        </h2>
        <ul className="pal-bullets t-body mt-2.5 space-y-1.5 text-[var(--lore-text-secondary)]">
          <li>
            Lore stops listening only to itself. The port becomes reachable from your
            network, and the password is the only thing standing in front of your wiki.
          </li>
          <li>
            The connection is plain HTTP. Anyone who can already read traffic on that
            network can read the pages you open and lift the password out of the link.
          </li>
          <li>
            So: fine on your own home or office wifi. Not fine on hotel, airport, or cafe
            wifi.
          </li>
        </ul>
      </section>

      <button
        type="button"
        onClick={onEnable}
        disabled={busy}
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-4 text-[13.5px] font-semibold text-[var(--lore-button-primary-fg)] transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
        Turn on remote access
      </button>
    </>
  );
}

/* ----------------------------------------------------------------------- on */

function OnState({
  status,
  address,
  onAddress,
  pairUrl,
  qr,
  copied,
  onCopy,
  busy,
  onAct,
}: {
  status: RemoteStatus;
  address: string | null;
  onAddress: (value: string) => void;
  pairUrl: string | null;
  qr: boolean[][] | null;
  copied: boolean;
  onCopy: () => void;
  busy: null | "enable" | "disable" | "rotate";
  onAct: (action: "disable" | "rotate") => void;
}) {
  return (
    <>
      {!status.listening ? (
        <p className="mb-5 flex items-start gap-2.5 rounded-xl border border-[var(--lore-border-strong)] bg-[var(--lore-surface)] px-4 py-3 text-[13px] text-[var(--lore-text-secondary)]">
          <TriangleAlert size={15} className="mt-px shrink-0 text-[var(--lore-text-tertiary)]" />
          <span>
            This link will not connect yet. Lore is still listening only on this computer,
            so nothing on your network can reach it — this build never opens the port, and
            restarting will not change that. Your password is saved and the pairing is
            real; it starts working the day Lore ships the switch that opens it.
          </span>
        </p>
      ) : null}

      {status.addresses.length === 0 ? (
        <p className="mb-5 flex items-start gap-2.5 rounded-xl border border-[var(--lore-border-strong)] bg-[var(--lore-surface)] px-4 py-3 text-[13px] text-[var(--lore-text-secondary)]">
          <TriangleAlert size={15} className="mt-px shrink-0 text-[var(--lore-text-tertiary)]" />
          This computer has no network address right now — it is not on wifi or ethernet, so
          there is nothing for a phone to connect to. Join a network and this page will show
          a link.
        </p>
      ) : null}

      {status.addresses.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            This machine answers on several addresses. Pick the one your phone is on:
          </span>
          {status.addresses.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => onAddress(candidate)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                candidate === address
                  ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
                  : "border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
              )}
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {candidate}
            </button>
          ))}
        </div>
      ) : null}

      {pairUrl ? (
        <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {qr ? (
              <QrImage modules={qr} />
            ) : (
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                This link is too long to fit in a QR code. Copy it instead.
              </p>
            )}

            <div className="min-w-0 flex-1">
              <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
                Point your camera at this
              </p>
              <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
                The link carries the password, so treat it like one. Anyone you send it to
                can read your whole wiki.
              </p>

              <p
                className="mt-3 break-all rounded-lg bg-[var(--lore-surface-raised)] px-3 py-2 text-[12px] leading-relaxed text-[var(--lore-text-primary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {pairUrl}
              </p>

              <button
                type="button"
                onClick={onCopy}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
              >
                {copied ? (
                  <Check size={13} className="text-[var(--lore-success)]" />
                ) : (
                  <Copy size={13} />
                )}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section
        style={paletteVars(2)}
        className="mt-4 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4"
      >
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="pal-bar !h-5" />
          <span className="pal-title">When this works, and when it stops</span>
        </h2>
        <ul className="pal-bullets t-body mt-2.5 space-y-1.5 text-[var(--lore-text-secondary)]">
          <li>
            Only while this computer is awake with Lore running. A sleeping laptop serves
            nothing.
          </li>
          <li>
            Only on the same network. Away from the house, the link will not connect — there
            is no copy of your wiki anywhere else.
          </li>
          <li>
            Lore has to be listening on your network rather than only on itself, and it
            decides that when it starts. The banner at the top of this screen says which
            one is true right now.
          </li>
          <li>
            Your router can hand this machine a different address after a reboot. If the
            link stops working, come back here and take the new one.
          </li>
          <li>Plain HTTP: fine on a network you control, not on public wifi.</li>
        </ul>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAct("rotate")}
          disabled={busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-60"
        >
          {busy === "rotate" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          New password
        </button>
        <button
          type="button"
          onClick={() => onAct("disable")}
          disabled={busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:border-[var(--lore-danger)]/40 hover:text-[var(--lore-danger)] disabled:opacity-60"
        >
          {busy === "disable" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Power size={13} />
          )}
          Turn off
        </button>
        {status.pairedAt ? (
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            Password created {relativeTime(status.pairedAt)}
          </span>
        ) : null}
      </div>
      <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
        A new password unpairs every device that has the old link. So does turning this off.
      </p>
    </>
  );
}

/**
 * The code is drawn dark-on-light in both themes rather than following the
 * page. An inverted QR code is legal but not every scanner reads one, and a
 * pairing code that works on some phones is worse than one that looks slightly
 * out of place.
 */
function QrImage({ modules }: { modules: boolean[][] }) {
  const size = modules.length;
  const quiet = 4;
  const total = size + quiet * 2;

  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label="QR code for the pairing link"
      shapeRendering="crispEdges"
      className="h-44 w-44 shrink-0 rounded-lg border border-[var(--lore-border)]"
    >
      <rect
        width={total}
        height={total}
        className="fill-[var(--lore-surface)] dark:fill-[var(--lore-text-primary)]"
      />
      <path d={path} className="fill-[var(--lore-text-primary)] dark:fill-[var(--lore-background)]" />
    </svg>
  );
}

/* ---------------------------------------------------------------- QR encoder
 *
 * A QR code means the phone never has to have a 43-character secret typed into
 * it by hand, which is the difference between a feature people use and one they
 * abandon. It is also not worth a dependency: what follows is byte-mode
 * encoding at error-correction level M, which is all of ISO/IEC 18004 that a
 * URL needs. Level M rather than L because the code gets photographed off a
 * screen, often at an angle.
 */

/** Error-correction codewords per block, level M, indexed by version. */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

/** Number of error-correction blocks, level M, indexed by version. */
const ECC_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21,
  23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** The two-bit id of level M in the format information. */
const ECC_FORMAT_BITS = 0b00;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

type Grid = { size: number; modules: boolean[][]; fixed: boolean[][] };

/**
 * Encode `text` and return the module grid, or null if it does not fit in any
 * QR version — the caller shows the link instead rather than a broken image.
 */
function qrModules(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));

  let version = 1;
  for (; version <= 40; version++) {
    const header = 4 + (version < 10 ? 8 : 16);
    if (bytes.length * 8 + header <= dataCodewords(version) * 8) break;
  }
  if (version > 40) return null;

  const grid = blankGrid(version);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, interleave(toBytes(encodeSegment(bytes, version)), version));

  // Every mask is legal — the chosen one is recorded in the format bits — so
  // this picks whichever produces the least camera-hostile pattern.
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const penalty = penaltyScore(grid);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(grid, mask); // XOR undoes itself
  }
  applyMask(grid, bestMask);
  drawFormatBits(grid, bestMask);

  return grid.modules;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * ECC_BLOCKS[version]
  );
}

function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function encodeSegment(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacity = dataCodewords(version) * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  // The standard's alternating pad bytes, which exist so an under-filled symbol
  // does not turn into a large flat region.
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  return bits;
}

function toBytes(bits: number[]): number[] {
  const bytes: number[] = new Array(bits.length / 8).fill(0);
  for (let i = 0; i < bits.length; i++) bytes[i >>> 3] |= bits[i] << (7 - (i & 7));
  return bytes;
}

/** Multiplication in GF(2^8) with the QR field's reducing polynomial. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/**
 * Split the data into blocks, append each block's error correction, then
 * interleave. The interleave is what makes a QR code survive a thumb over one
 * corner: damage lands across many blocks rather than destroying one.
 */
function interleave(data: number[], version: number): number[] {
  const numBlocks = ECC_BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const divisor = rsDivisor(eccLen);

  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const length = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
    const chunk = data.slice(offset, offset + length);
    offset += length;
    // Every block is padded to the long length so the interleave below can read
    // a fixed grid; the hole in a short block is skipped, not emitted.
    const block: number[] = new Array(shortBlockLen + 1).fill(0);
    for (let j = 0; j < chunk.length; j++) block[j] = chunk[j];
    const ecc = rsRemainder(chunk, divisor);
    for (let j = 0; j < eccLen; j++) block[block.length - eccLen + j] = ecc[j];
    blocks.push(block);
  }

  const result: number[] = [];
  for (let i = 0; i < shortBlockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

function blankGrid(version: number): Grid {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

/** Set a module that belongs to the symbol's structure, not to the data. */
function setFixed(grid: Grid, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
  grid.modules[y][x] = dark;
  grid.fixed[y][x] = true;
}

const bitAt = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const { size } = grid;

  for (let i = 0; i < size; i++) {
    setFixed(grid, 6, i, i % 2 === 0);
    setFixed(grid, i, 6, i % 2 === 0);
  }

  for (const [x, y] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFixed(grid, x + dx, y + dy, distance !== 2 && distance !== 4);
      }
    }
  }

  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      // The three corners are already finder patterns.
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFixed(grid, align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format cells; the real values land once a mask is chosen.
  drawFormatBits(grid, 0);
  drawVersionBits(grid, version);
}

function drawFormatBits(grid: Grid, mask: number): void {
  const { size } = grid;
  const data = (ECC_FORMAT_BITS << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFixed(grid, 8, i, bitAt(bits, i));
  setFixed(grid, 8, 7, bitAt(bits, 6));
  setFixed(grid, 8, 8, bitAt(bits, 7));
  setFixed(grid, 7, 8, bitAt(bits, 8));
  for (let i = 9; i < 15; i++) setFixed(grid, 14 - i, 8, bitAt(bits, i));

  for (let i = 0; i < 8; i++) setFixed(grid, size - 1 - i, 8, bitAt(bits, i));
  for (let i = 8; i < 15; i++) setFixed(grid, 8, size - 15 + i, bitAt(bits, i));
  setFixed(grid, 8, size - 8, true); // the always-dark module
}

function drawVersionBits(grid: Grid, version: number): void {
  if (version < 7) return;
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const dark = bitAt(bits, i);
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFixed(grid, a, b, dark);
    setFixed(grid, b, a, dark);
  }
}

/** Zigzag up and down two-module columns, skipping the vertical timing line. */
function drawCodewords(grid: Grid, data: number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!grid.fixed[y][x] && i < data.length * 8) {
          grid.modules[y][x] = bitAt(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(grid: Grid, mask: number): void {
  const { size } = grid;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid.fixed[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
          break;
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0;
          break;
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
        default:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
      }
      if (invert) grid.modules[y][x] = !grid.modules[y][x];
    }
  }
}

/** Shift a run length into the seven-entry window the finder test reads. */
function addRun(history: number[], length: number, size: number): void {
  if (history[0] === 0) length += size; // the light margin before the first run
  history.pop();
  history.unshift(length);
}

/** Does the window hold a 1:1:3:1:1 finder-lookalike with a wide light side? */
function countFinderLike(history: number[]): number {
  const n = history[1];
  const core =
    n > 0 &&
    history[2] === n &&
    history[3] === n * 3 &&
    history[4] === n &&
    history[5] === n;
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}

function terminateRun(
  history: number[],
  runDark: boolean,
  runLength: number,
  size: number,
): number {
  if (runDark) {
    addRun(history, runLength, size);
    runLength = 0;
  }
  runLength += size; // the light margin after the last run
  addRun(history, runLength, size);
  return countFinderLike(history);
}

/** The standard's four masking penalties. Lower is easier for a camera. */
function penaltyScore(grid: Grid): number {
  const { size, modules } = grid;
  let result = 0;

  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let runDark = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const dark = pass === 0 ? modules[a][b] : modules[b][a];
        if (dark === runDark) {
          runLength++;
          if (runLength === 5) result += PENALTY_N1;
          else if (runLength > 5) result++;
        } else {
          addRun(history, runLength, size);
          if (!runDark) result += countFinderLike(history) * PENALTY_N3;
          runDark = dark;
          runLength = 1;
        }
      }
      result += terminateRun(history, runDark, runLength, size) * PENALTY_N3;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = modules[y][x];
      if (dark === modules[y][x + 1] && dark === modules[y + 1][x] && dark === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const skew = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
  return result + skew * PENALTY_N4;
}
