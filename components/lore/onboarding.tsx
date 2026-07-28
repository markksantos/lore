"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  ArrowRight,
  Loader2,
  FolderSearch,
  Eye,
  PencilLine,
  Check,
  Sparkles,
  Copy,
} from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { BrandMark } from "@/components/marketing/brand-mark";
import { formatCount, cn } from "@/lib/utils";
import type { Scene } from "@/lib/scenery";
import { canPickFolder, desktopBridge } from "@/lib/desktop";

/**
 * First run.
 *
 * Four questions, in the order someone actually needs them answered:
 *
 *   1. Do you already have a wiki?   — link it, or have one made
 *   2. What may Lore do to it?       — read-only, or allowed to write
 *   3. Which agent should read it?   — the MCP config, copyable, skippable
 *   4. Done                          — open it
 *
 * Question 2 is the one that matters. The most common reaction to this app,
 * from exactly the people most likely to use it, is a worry that it will change
 * or delete something an agent wrote. Asking on the way in — and defaulting to
 * the answer that makes it impossible — settles that before they have to wonder.
 *
 * Nothing is activated until the last step, so backing out of a wrong folder
 * costs nothing.
 */

type Step = "wiki" | "permission" | "connect" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "wiki", label: "Your wiki" },
  { id: "permission", label: "Permission" },
  { id: "connect", label: "Connect" },
  { id: "done", label: "Done" },
];

export function Onboarding({
  suggestions,
  scene,
}: {
  suggestions: { root: string; files: number }[];
  scene: Scene;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("wiki");
  const [mode, setMode] = useState<"link" | "create" | null>(null);
  const [path, setPath] = useState("");
  const [newPath, setNewPath] = useState("~/wiki");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ root: string; created?: number } | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [mcpConfig, setMcpConfig] = useState("");
  const [copied, setCopied] = useState(false);

  /* Resolved after mount: window.lore and navigator only exist in the browser,
     and reading either during render would not match the server's HTML. */
  const [canBrowse, setCanBrowse] = useState(false);

  useEffect(() => {
    setCanBrowse(canPickFolder());
    const bridge = desktopBridge();
    return bridge?.onVaultFolderChosen((folder) => void link(folder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetched only when that step is reached, because the config embeds the path
  // of the vault that was just chosen.
  useEffect(() => {
    if (step !== "connect") return;
    fetch("/api/harness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMcpConfig(String(d?.snippets?.mcp ?? "")))
      .catch(() => setMcpConfig(""));
  }, [step]);

  /**
   * Ask the OS for a folder. The Electron bridge works on all three desktops;
   * a browser falls back to /api/pick, which shells out to osascript and is
   * therefore macOS-only — which is why the button hides itself elsewhere
   * rather than offering something that returns 501.
   */
  async function browse() {
    setPicking(true);
    setError(null);

    const bridge = desktopBridge();
    if (bridge) {
      const chosen = await bridge.chooseVaultFolder().catch(() => null);
      setPicking(false);
      if (chosen) void link(chosen);
      return;
    }

    const response = await fetch("/api/pick", { method: "POST" }).catch(() => null);
    setPicking(false);
    if (!response?.ok) return;
    const data = await response.json();
    if (data.path) void link(data.path);
  }

  async function link(target: string) {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "link", path: target }),
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(data.error ?? "Could not link that folder.");
      return;
    }
    setLinked({ root: data.vault.root });
    setStep("permission");
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", path: newPath }),
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(data.error ?? "Could not create a wiki there.");
      return;
    }
    setLinked({ root: data.vault.root, created: data.created?.length ?? 0 });
    setStep("permission");
  }

  async function choosePermission(next: boolean) {
    setReadOnly(next);
    setBusy(true);
    await fetch("/api/safety", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readOnly: next }),
    }).catch(() => {});
    setBusy(false);
    setStep("connect");
  }

  async function finish() {
    if (!linked) return;
    setBusy(true);
    await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activate", root: linked.root }),
    }).catch(() => {});
    router.refresh();
  }

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-[var(--lore-background)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42svh] overflow-hidden">
        <SceneryImage
          src={scene.light}
          fileName={`hero-${scene.id}.png`}
          label={scene.label}
          priority
          className="dark:hidden"
        />
        <SceneryImage
          src={scene.dark}
          fileName={`hero-${scene.id}-dark.png`}
          label={`${scene.label} (dark)`}
          className="hidden dark:block"
        />
        <div
          className="absolute inset-x-0 bottom-0 h-full"
          style={{ backgroundImage: "var(--scenery-fade-down)" }}
        />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-5 py-14">
        <div className="lore-fade-up w-full max-w-[34rem]">
          <div className="mb-6 flex items-center justify-center gap-2 text-white drop-shadow-sm">
            <BrandMark size={22} />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">Lore</span>
          </div>

          <Progress step={step} />

          <div className="mt-4 rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-6 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
            {step === "wiki" ? (
              <WikiStep
                mode={mode}
                setMode={setMode}
                suggestions={suggestions}
                path={path}
                setPath={setPath}
                newPath={newPath}
                setNewPath={setNewPath}
                canBrowse={canBrowse}
                picking={picking}
                busy={busy}
                onBrowse={browse}
                onLink={link}
                onCreate={create}
              />
            ) : null}

            {step === "permission" ? (
              <PermissionStep busy={busy} onChoose={choosePermission} />
            ) : null}

            {step === "connect" ? (
              <ConnectStep
                config={mcpConfig}
                copied={copied}
                onCopy={() => {
                  navigator.clipboard.writeText(mcpConfig);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                onNext={() => setStep("done")}
              />
            ) : null}

            {step === "done" ? (
              <DoneStep
                root={linked?.root ?? ""}
                created={linked?.created}
                readOnly={readOnly}
                busy={busy}
                onFinish={finish}
              />
            ) : null}

            {error ? (
              <p className="t-meta mt-4 text-[var(--lore-danger)]" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <p className="t-meta mt-5 text-center text-[var(--lore-text-tertiary)]">
            Lore stores only the folder path, in <code>~/.lore/config.json</code>.
          </p>
        </div>
      </div>
    </main>
  );
}

function Progress({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-1.5">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              i < index && "bg-[var(--lore-success)]/14 text-[var(--lore-success)]",
              i === index && "bg-[var(--lore-accent)] text-white",
              i > index && "bg-[var(--lore-surface-raised)] text-[var(--lore-text-tertiary)]",
            )}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 ? (
            <span className="h-px w-3 bg-[var(--lore-border-strong)]" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function WikiStep({
  mode,
  setMode,
  suggestions,
  path,
  setPath,
  newPath,
  setNewPath,
  canBrowse,
  picking,
  busy,
  onBrowse,
  onLink,
  onCreate,
}: {
  mode: "link" | "create" | null;
  setMode: (m: "link" | "create") => void;
  suggestions: { root: string; files: number }[];
  path: string;
  setPath: (v: string) => void;
  newPath: string;
  setNewPath: (v: string) => void;
  canBrowse: boolean;
  picking: boolean;
  busy: boolean;
  onBrowse: () => void;
  onLink: (target: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <h1 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
        Do you already have a wiki?
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        A folder of markdown counts — an Obsidian vault, a <code>notes/</code> directory, the
        docs folder in a repo. Lore reads it where it is and never moves anything.
      </p>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <Choice
          selected={mode === "link"}
          onClick={() => setMode("link")}
          icon={FolderOpen}
          title="Yes, I have one"
          body="Point Lore at the folder."
        />
        <Choice
          selected={mode === "create"}
          onClick={() => setMode("create")}
          icon={Sparkles}
          title="No, make me one"
          body="Starter pages and a folder layout."
        />
      </div>

      {mode === "link" ? (
        <div className="mt-5">
          {suggestions.length > 0 ? (
            <>
              <p className="t-meta mb-2 text-[var(--lore-text-tertiary)]">Found on this machine</p>
              <div className="space-y-1.5">
                {suggestions.slice(0, 3).map((s) => (
                  <button
                    key={s.root}
                    type="button"
                    onClick={() => onLink(s.root)}
                    disabled={busy}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--lore-border)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
                  >
                    <FolderSearch size={15} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                    <span
                      className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lore-text-primary)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {s.root.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                    <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                      {formatCount(s.files)} pages
                    </span>
                  </button>
                ))}
              </div>
              <p className="t-meta mb-2 mt-4 text-[var(--lore-text-tertiary)]">Or type a path</p>
            </>
          ) : null}

          <div className="flex gap-2">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLink(path)}
              placeholder="~/Documents/wiki"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 py-2.5 text-[13px] text-[var(--lore-text-primary)] outline-none transition-colors focus:border-[var(--lore-accent)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
            {canBrowse ? (
              <button
                type="button"
                onClick={onBrowse}
                disabled={picking}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--lore-border)] px-3.5 text-[13.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
              >
                {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                Browse
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => onLink(path)}
            disabled={busy || !path.trim()}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Link this folder
          </button>
        </div>
      ) : null}

      {mode === "create" ? (
        <div className="mt-5">
          <p className="t-meta mb-2 text-[var(--lore-text-tertiary)]">Where should it live?</p>
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            spellCheck={false}
            className="w-full rounded-xl border border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 py-2.5 text-[13px] text-[var(--lore-text-primary)] outline-none transition-colors focus:border-[var(--lore-accent)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          />
          <p className="t-meta mt-2 leading-relaxed text-[var(--lore-text-tertiary)]">
            Creates an index, a page on how to keep a wiki useful, a log, one worked example,
            and an <code>AGENTS.md</code> so the first agent that opens it already knows the
            house rules. The folder has to be empty.
          </p>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || !newPath.trim()}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Create my wiki
          </button>
        </div>
      ) : null}
    </>
  );
}

function PermissionStep({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (readOnly: boolean) => void;
}) {
  return (
    <>
      <h1 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
        What may Lore do to it?
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        Changeable at any time in Settings. Neither answer affects your agents — they write to
        your files directly, exactly as they do now.
      </p>

      <div className="mt-5 space-y-2.5">
        <button
          type="button"
          onClick={() => onChoose(true)}
          disabled={busy}
          className="w-full rounded-xl border-2 border-[var(--lore-accent)] bg-[var(--lore-accent)]/[0.04] p-4 text-left transition-colors hover:bg-[var(--lore-accent)]/[0.08] disabled:opacity-50"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Eye size={16} className="text-[var(--lore-accent)]" />
            <span className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
              Look, don&apos;t touch
            </span>
            <span className="rounded-md bg-[var(--lore-accent)]/12 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--lore-accent)]">
              Recommended
            </span>
          </div>
          <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
            Read, search, map and report — and refused if it tries to write a single byte. Not
            a setting Lore promises to respect: every route that could change a file is
            blocked before it runs.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onChoose(false)}
          disabled={busy}
          className="w-full rounded-xl border border-[var(--lore-border)] p-4 text-left transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <PencilLine size={16} className="text-[var(--lore-text-secondary)]" />
            <span className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
              Let me edit here too
            </span>
          </div>
          <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
            Adds editing, page creation, capture and rollback. Lore still never writes on its
            own — every change is one you made.
          </p>
        </button>
      </div>
    </>
  );
}

function ConnectStep({
  config,
  copied,
  onCopy,
  onNext,
}: {
  config: string;
  copied: boolean;
  onCopy: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h1 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
        Let an agent read it
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        Optional. This gives Claude Code, Cursor, Claude Desktop or anything else that speaks
        MCP a way to search your wiki instead of guessing at it.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--lore-border)]">
        <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3.5 py-1.5">
          <span className="t-meta text-[var(--lore-text-tertiary)]">MCP config</span>
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "inline-flex items-center gap-1.5 text-[12px] transition-colors",
              copied
                ? "text-[var(--lore-success)]"
                : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
            )}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          className="lore-scrollbar max-h-40 overflow-auto bg-[var(--lore-background)] px-3.5 py-3 text-[11.5px] leading-[1.65] text-[var(--lore-text-primary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {config || "Loading…"}
        </pre>
      </div>

      <p className="t-meta mt-2.5 leading-relaxed text-[var(--lore-text-tertiary)]">
        Paste it into your client&apos;s MCP settings and restart it. Connections has
        per-client instructions if you would rather do this later.
      </p>

      <button
        type="button"
        onClick={onNext}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
      >
        Continue
        <ArrowRight size={15} />
      </button>
    </>
  );
}

function DoneStep({
  root,
  created,
  readOnly,
  busy,
  onFinish,
}: {
  root: string;
  created?: number;
  readOnly: boolean;
  busy: boolean;
  onFinish: () => void;
}) {
  return (
    <>
      <h1 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
        Ready.
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        {created ? `Created ${created} starter pages in ` : "Lore will read "}
        <code>{root.replace(/^\/Users\/[^/]+/, "~")}</code>
        {created ? "." : " and watch it for changes."}
      </p>

      <ul className="lore-bullets mt-4 space-y-2 text-[14px] leading-[1.7] text-[var(--lore-text-secondary)]">
        <li>
          {readOnly
            ? "Read-only is on. Lore cannot change your files — anything that tries is refused."
            : "Editing is on. Lore writes only when you do; nothing happens on its own."}
        </li>
        <li>It watches the folder, so whatever your agents write turns up by itself.</li>
        <li>Review shows what changed. It is a record, not a queue you have to clear.</li>
      </ul>

      <button
        type="button"
        onClick={onFinish}
        disabled={busy}
        className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        Open my wiki
        <ArrowRight size={15} />
      </button>
    </>
  );
}

function Choice({
  selected,
  onClick,
  icon: Icon,
  title,
  body,
}: {
  selected: boolean;
  onClick: () => void;
  icon: typeof FolderOpen;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3.5 text-left transition-colors",
        selected
          ? "border-[var(--lore-accent)] bg-[var(--lore-accent)]/[0.05]"
          : "border-[var(--lore-border)] hover:bg-[var(--lore-surface-raised)]",
      )}
    >
      <Icon
        size={16}
        className={selected ? "text-[var(--lore-accent)]" : "text-[var(--lore-text-tertiary)]"}
      />
      <p className="mt-2 text-[14px] font-semibold text-[var(--lore-text-primary)]">{title}</p>
      <p className="t-meta mt-0.5 text-[var(--lore-text-secondary)]">{body}</p>
    </button>
  );
}
