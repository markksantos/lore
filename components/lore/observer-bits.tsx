"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";

/**
 * The parts every observer screen needs, written once.
 *
 * Seven features arrived together and six of them have the same skeleton: a
 * consent switch with a plain sentence attached, a strip of numbers saying what
 * has been collected, a list of permissions that may be missing, and a way to
 * delete everything. Writing that seven times would produce seven slightly
 * different consent switches — and a privacy control that behaves differently
 * depending on which screen you found it on is worse than no consistency at all,
 * because the user's model of it is wrong somewhere and they cannot tell where.
 *
 * So the switch lives here, the "this is what it reads" sentence is required
 * rather than optional, and the delete button always asks twice.
 */

// ------------------------------------------------------------------- fetching

/**
 * A JSON GET that cannot hang.
 *
 * Every screen in this app that shipped without a timeout eventually became an
 * infinite spinner in somebody's review, because a starved local server does
 * not refuse a connection — it accepts it and says nothing. Twelve seconds,
 * always, and a failure is a value rather than an exception.
 */
export async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs = 180_000,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, error: data.error ?? `Request failed (${response.status}).` };
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === "TimeoutError"
        ? "That took too long and was given up on."
        : "Could not reach Lore's local server.",
    };
  }
}

export async function putJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- layout

export function ViewFrame({
  title,
  lede,
  right,
  children,
}: {
  title: string;
  lede: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="t-section text-[var(--lore-text-primary)]">{title}</h1>
          <p className="t-body mt-1 max-w-[62ch] text-[var(--lore-text-secondary)]">{lede}</p>
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Panel({
  title,
  hint,
  right,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "mt-4 min-w-0 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4",
        className,
      )}
    >
      {title ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
              {title}
            </h2>
            {hint ? <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">{hint}</p> : null}
          </div>
          {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Button({
  onClick,
  children,
  variant = "ghost",
  busy,
  disabled,
  title,
  className,
}: {
  onClick?: () => void;
  children: ReactNode;
  variant?: "ghost" | "primary" | "danger";
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50",
        variant === "primary" &&
          "bg-[var(--lore-accent)] text-[var(--lore-button-primary-fg)] hover:bg-[var(--lore-accent-hover)]",
        variant === "ghost" &&
          "border border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
        variant === "danger" &&
          "border border-[var(--lore-border)] text-[var(--lore-danger)] hover:bg-[var(--lore-surface-raised)]",
        className,
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Numbers across the top of a screen. Nothing here is ever a fabricated total. */
export function Stats({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          title={item.hint}
          className="min-w-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 py-2"
        >
          <div className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            {item.value}
          </div>
          <div className="t-meta truncate text-[var(--lore-text-tertiary)]">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="t-body rounded-lg border border-dashed border-[var(--lore-border)] px-4 py-6 text-center text-[var(--lore-text-tertiary)]">
      {children}
    </p>
  );
}

/**
 * A failure, announced.
 *
 * `role="alert"` is not decoration here. Every one of these screens does its
 * work asynchronously — indexing, drafting, convening a panel — and reports
 * failure by swapping in a paragraph somewhere below the button that was
 * pressed. Without a live region a screen-reader user presses "Index now",
 * hears nothing, and has no way to discover that it failed.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="t-meta mt-2 flex items-start gap-1.5 text-[var(--lore-danger)]"
    >
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// -------------------------------------------------------------------- consent

/**
 * The switch, and the sentence that has to sit beside it.
 *
 * `reads` is a required prop, not an optional one. Every one of these features
 * watches something a person is right to be careful about, and a toggle labelled
 * only with a product name is a toggle nobody can give informed consent to. The
 * component makes the honest label unavoidable.
 */
export function ConsentSwitch({
  id,
  label,
  reads,
  enabled,
  enabledAt,
  blockedBecause,
  onChange,
}: {
  id: string;
  label: string;
  reads: string;
  enabled: boolean;
  enabledAt?: number | null;
  blockedBecause?: string | null;
  onChange: (next: boolean) => unknown;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        /*
         * The name is the thing, not the state. `aria-checked` already carries
         * on/off and a screen reader announces both — putting the state in the
         * name too means hearing it twice, and the second one goes stale the
         * instant it is pressed.
         *
         * `aria-describedby` is what makes this switch informed consent rather
         * than a labelled toggle: the sentence saying what it reads, the reason
         * it cannot run, and the line about staying on the machine are all read
         * out with it. That privacy paragraph already had an id and nothing
         * referenced it.
         */
        aria-label={label}
        aria-describedby={[`${id}-reads`, blockedBecause ? `${id}-blocked` : null, `${id}-privacy`]
          .filter(Boolean)
          .join(" ")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onChange(!enabled);
          } finally {
            setBusy(false);
          }
        }}
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60",
          enabled ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] font-semibold text-[var(--lore-text-primary)]">{label}</span>
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            {enabled
              ? enabledAt
                ? `on since ${relativeTime(enabledAt)}`
                : "on"
              : "off"}
          </span>
        </div>
        <p id={`${id}-reads`} className="t-body mt-1 text-[var(--lore-text-secondary)]">
          {reads}
        </p>
        {blockedBecause ? (
          <p id={`${id}-blocked`} className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">
            {blockedBecause}
          </p>
        ) : null}
        <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]" id={`${id}-privacy`}>
          Stays on this machine. Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}

/**
 * A missing permission, with the pane that grants it.
 *
 * The link matters more than the message. "Grant Full Disk Access" is advice;
 * a control that opens the exact System Settings pane is a fix, and the
 * difference is most of whether anyone completes it.
 */
export function CapabilityNotice({
  capability,
  what,
  onRecheck,
}: {
  capability: { state: string; detail: string; settingsPane?: string };
  what: string;
  onRecheck?: () => unknown;
}) {
  const [checking, setChecking] = useState(false);
  if (capability.state === "ready") return null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--lore-text-tertiary)]" />
        <div className="min-w-0 flex-1">
          <p className="t-body text-[var(--lore-text-secondary)]">
            <span className="font-medium text-[var(--lore-text-primary)]">{what}</span>{" "}
            {capability.detail}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {capability.settingsPane ? (
              <a
                href={capability.settingsPane}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)] hover:text-[var(--lore-text-primary)]"
              >
                <ExternalLink size={12} />
                Open System Settings
              </a>
            ) : null}
            {onRecheck ? (
              <Button
                busy={checking}
                onClick={async () => {
                  setChecking(true);
                  try {
                    await onRecheck();
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                <RotateCcw size={12} />
                Check again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Delete, with the second press that makes it a decision.
 *
 * No modal. A confirmation dialog is dismissed reflexively; a button that
 * changes into "Really delete everything?" and reverts after five seconds
 * cannot be clicked twice by accident and costs nobody a keystroke.
 */
export function DangerButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => unknown;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const arm = useCallback(() => {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 5_000);
  }, []);

  return (
    <Button
      variant="danger"
      busy={busy}
      onClick={async () => {
        if (!armed) {
          arm();
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        setArmed(false);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/** Bytes, in the unit a person would say out loud. */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1_048_576) return `${Math.round(n / 1024)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(n < 10_485_760 ? 1 : 0)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** A big number, shortened. 55,394 → 55.4k. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** A short, absolute time. Relative times are useless in a per-minute list. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dayAndTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The "it worked" tick that fades. Used after a save with no other feedback. */
export function Saved({ at }: { at: number | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShow(true);
    const timer = setTimeout(() => setShow(false), 2_000);
    return () => clearTimeout(timer);
  }, [at]);
  if (!show) return null;
  return (
    <span className="t-meta inline-flex items-center gap-1 text-[var(--lore-success)]">
      <Check size={12} />
      Saved
    </span>
  );
}

/** A field for a folder path, with the Browse button when one is possible. */
export function PathInput({
  placeholder,
  onAdd,
  busy,
}: {
  placeholder: string;
  onAdd: (path: string) => unknown;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const [picking, setPicking] = useState(false);
  const [canPick, setCanPick] = useState(false);

  /* Whether a native picker exists is a client-only question — it depends on
     the Electron bridge and on navigator.platform — so it is resolved after
     mount rather than guessed during render. */
  useEffect(() => {
    let alive = true;
    void import("@/lib/desktop").then(({ canPickFolder }) => {
      if (alive) setCanPick(canPickFolder());
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (chosen?: string) => {
    const target = (chosen ?? value).trim();
    if (!target) return;
    await onAdd(target);
    setValue("");
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder={placeholder}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[13px]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      />
      {canPick ? (
        <Button
          busy={picking}
          onClick={async () => {
            setPicking(true);
            try {
              const { desktopBridge } = await import("@/lib/desktop");
              const bridge = desktopBridge();
              /* /api/pick is a POST — it opens a dialog, which is not a GET.
                 Calling it as one returned 405 and the Browse button did
                 nothing at all on a Mac without the desktop bridge. */
              const picked = bridge
                ? await bridge.chooseVaultFolder()
                : await postJson<{ path?: string }>("/api/pick", {}, 120_000).then((result) =>
                    result.ok ? (result.data.path ?? null) : null,
                  );
              const chosen = picked;
              if (chosen) await submit(chosen);
            } finally {
              setPicking(false);
            }
          }}
        >
          Browse
        </Button>
      ) : null}
      <Button variant="primary" busy={busy} onClick={() => void submit()}>
        Add
      </Button>
    </div>
  );
}
