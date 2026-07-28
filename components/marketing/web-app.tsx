"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  FolderOpen,
  Loader2,
  Lock,
  Monitor,
  Sparkles,
} from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { VaultApp } from "@/components/lore/vault-app";
import {
  SUPPORTED,
  createWiki,
  forgetFolder,
  pickFolder,
  requestAccess,
  restoreFolder,
  scan,
  type ScanProgress,
} from "@/lib/browser-vault";
import { installBrowserApi } from "@/lib/browser-api";
import type { VaultIndex } from "@/lib/types";
import type { WikiIndex } from "@/lib/index-core";

/**
 * Lore in a browser tab, on your own folder.
 *
 * This is the answer to "where is the web app". Not a hosted copy of your wiki
 * — the whole product is built on your notes not going anywhere — but the real
 * interface, running on the real folder, with the file access granted by you
 * and revocable by you. Nothing is uploaded; the page is static and the server
 * that delivered it is not contacted again.
 *
 * It is read-only, and not by our own promise: the folder is opened with
 * `mode: "read"`, so the browser itself refuses a write.
 */

type Stage =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "idle" }
  | { kind: "regrant"; folder: string }
  | { kind: "naming" }
  | { kind: "creating" }
  | { kind: "scanning"; progress: ScanProgress | null }
  | { kind: "ready"; index: VaultIndex }
  | { kind: "error"; message: string };

export function WebApp() {
  const [stage, setStage] = useState<Stage>({ kind: "checking" });

  const load = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setStage({ kind: "scanning", progress: null });
    try {
      const { index, texts } = await scan(handle, (progress) =>
        setStage({ kind: "scanning", progress }),
      );
      installBrowserApi({ index, texts, name: handle.name });
      setStage({ kind: "ready", index: toVaultIndex(index) });
    } catch (error) {
      setStage({
        kind: "error",
        message: error instanceof Error ? error.message : "That folder could not be read.",
      });
    }
  }, []);

  useEffect(() => {
    if (!SUPPORTED) {
      setStage({ kind: "unsupported" });
      return;
    }
    restoreFolder()
      .then((saved) => {
        if (!saved) return setStage({ kind: "idle" });
        // Permission cannot be re-requested without a click, so a returning
        // user gets one button naming their folder rather than a picker that
        // makes it look like Lore forgot which one it was.
        if (!saved.granted) return setStage({ kind: "regrant", folder: saved.handle.name });
        return load(saved.handle);
      })
      .catch(() => setStage({ kind: "idle" }));
  }, [load]);

  async function choose() {
    try {
      const handle = await pickFolder();
      // null means the picker was dismissed, which is not a failure and needs
      // no message. Everything else lands in the catch and gets shown.
      if (handle) await load(handle);
    } catch (error) {
      setStage({ kind: "error", message: describe(error) });
    }
  }

  /**
   * Write a starter wiki into an empty folder, then open it like any other.
   *
   * Deliberately two steps: the name is asked for first, in this page, so that
   * the folder picker — the moment the browser hands over write access — is the
   * last thing that happens before files appear. Nobody should be granting write
   * permission while still deciding what to call it.
   */
  async function create(name: string) {
    setStage({ kind: "creating" });
    try {
      const handle = await createWiki(name);
      if (!handle) return setStage({ kind: "naming" });
      await load(handle);
    } catch (error) {
      setStage({ kind: "error", message: describe(error) });
    }
  }

  async function regrant() {
    try {
      const saved = await restoreFolder();
      if (!saved) return setStage({ kind: "idle" });
      if (await requestAccess(saved.handle)) await load(saved.handle);
      else
        setStage({
          kind: "error",
          message: "Your browser did not grant access to that folder.",
        });
    } catch (error) {
      setStage({ kind: "error", message: describe(error) });
    }
  }

  if (stage.kind === "ready") {
    return (
      <div className="flex h-svh flex-col">
        <BrowserBanner
          folder={stage.index.name}
          onSwitch={choose}
          onForget={async () => {
            await forgetFolder();
            location.reload();
          }}
        />
        <div className="min-h-0 flex-1">
          <VaultApp initialIndex={stage.index} installDir="" />
        </div>
      </div>
    );
  }

  return (
    <>
      <MarketingHeader />
      <main className="mx-auto max-w-2xl px-6 pb-24 pt-36">
        <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
          Lore on the web
        </p>
        <h1 className="t-section mt-2 text-[var(--lore-text-primary)]">
          Open your wiki in this tab.
        </h1>
        <p className="t-lede mt-3 text-[var(--lore-text-secondary)]">
          Point this page at the folder your markdown already lives in — or start a new one
          if you have agents but nothing to point them at yet. Either way it reads the files
          straight off your disk: nothing is uploaded, there is no account, and this page
          does not talk to a server again after it loads.
        </p>

        <Body
          stage={stage}
          onChoose={choose}
          onRegrant={regrant}
          onCreate={() => setStage({ kind: "naming" })}
          onName={create}
          onCancelName={() => setStage({ kind: "idle" })}
        />

        <div className="mt-10 grid gap-3 border-t border-[var(--lore-border)] pt-8 sm:grid-cols-2">
          <Note
            icon={<Lock size={14} />}
            title="Read-only, enforced by the browser"
            body="A wiki you open is opened read-only, so a write is refused below this code, and sign-offs live in this browser rather than in your files. Starting a new wiki is the single exception — it writes the starter pages into an empty folder you pick, then reopens it read-only."
          />
          <Note
            icon={<Monitor size={14} />}
            title="What the app adds"
            body="A watcher that sees what your agents changed and by how much, page history and diffs, the MCP server your agents connect to, local AI, and phone access."
          />
        </div>

        <Link
          href="/download"
          className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--lore-accent)] transition-colors hover:text-[var(--lore-accent-hover)]"
        >
          Get the desktop app
          <ArrowRight size={14} />
        </Link>
      </main>
      <MarketingFooter />
    </>
  );
}

function Body({
  stage,
  onChoose,
  onRegrant,
  onCreate,
  onName,
  onCancelName,
}: {
  stage: Stage;
  onChoose: () => void;
  onRegrant: () => void;
  onCreate: () => void;
  onName: (name: string) => void;
  onCancelName: () => void;
}) {
  const button =
    "mt-8 inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-[var(--lore-accent)] px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]";

  if (stage.kind === "checking") {
    return (
      <div className="mt-8 flex h-11 items-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (stage.kind === "unsupported") {
    return (
      <div className="mt-8 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5">
        <p className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--lore-text-primary)]">
          <AlertTriangle size={15} className="text-[#b45309] dark:text-[#fbbf24]" />
          This browser cannot open a folder
        </p>
        <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
          Reading a local folder needs the File System Access API, which Chrome, Edge, Arc
          and Brave have and Safari and Firefox do not. The workaround — uploading a copy of
          your notes — is the one thing this is built not to do, so there is no fallback
          here on purpose. Open this page in a Chromium browser, or use the desktop app,
          which works everywhere.
        </p>
        <Link
          href="/download"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
        >
          Download Lore
        </Link>
      </div>
    );
  }

  if (stage.kind === "regrant") {
    return (
      <div className="mt-8">
        <button type="button" onClick={onRegrant} className={button.replace("mt-8 ", "")}>
          <FolderOpen size={16} />
          Reopen {stage.folder}
        </button>
        <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
          Your browser asks again each session. That is the permission model working — the
          page cannot reach your disk without you saying so.
        </p>
      </div>
    );
  }

  if (stage.kind === "naming") {
    return <NameForm onSubmit={onName} onCancel={onCancelName} />;
  }

  if (stage.kind === "creating") {
    return (
      <div className="mt-8 flex h-11 items-center gap-2.5 text-[var(--lore-text-secondary)]">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[14.5px]">Writing your wiki…</span>
      </div>
    );
  }

  if (stage.kind === "scanning") {
    const p = stage.progress;
    return (
      <div className="mt-8 flex h-11 items-center gap-2.5 text-[var(--lore-text-secondary)]">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[14.5px] tabular-nums">
          {!p
            ? "Opening the folder…"
            : p.phase === "listing"
              ? `Found ${p.done} pages…`
              : `Reading ${p.done} of ${p.total}…`}
        </span>
      </div>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="mt-8">
        <p className="flex items-start gap-2 text-[14.5px] leading-[1.6] text-[var(--lore-danger)]">
          <AlertTriangle size={15} className="mt-[3px] shrink-0" />
          {stage.message}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onChoose} className={button}>
            <FolderOpen size={16} />
            Try another folder
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="mt-8 inline-flex h-11 w-fit items-center gap-2 rounded-xl border border-[var(--lore-border-strong)] px-5 text-[14.5px] font-medium text-[var(--lore-text-primary)] transition-colors hover:bg-[var(--lore-surface-raised)]"
          >
            <Sparkles size={15} />
            Start a new wiki
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onChoose} className={button.replace("mt-8 ", "")}>
        <FolderOpen size={16} />
        Choose your wiki folder
      </button>
      {/* The second door, for the larger group nobody was serving: people who
          have agents but no wiki yet. "Make a folder and write some notes" is
          not an onboarding step, it is homework. */}
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex h-11 w-fit items-center gap-2 rounded-xl border border-[var(--lore-border-strong)] px-5 text-[14.5px] font-medium text-[var(--lore-text-primary)] transition-colors hover:bg-[var(--lore-surface-raised)]"
      >
        <Sparkles size={15} />
        I don&rsquo;t have one yet
      </button>
    </div>
  );
}

/**
 * A permanent line above the app saying which folder is open and that it cannot
 * be written to. The desktop app puts this in Settings; here it stays on screen,
 * because a web page holding a handle to your disk is exactly the situation
 * where "which folder, and can it change it" should never require a click.
 */
function BrowserBanner({
  folder,
  onSwitch,
  onForget,
}: {
  folder: string;
  onSwitch: () => void;
  onForget: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-2">
      <Link
        href="/"
        className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]"
      >
        Lore
      </Link>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lore-surface-raised)] px-2.5 py-1 text-[12px] text-[var(--lore-text-secondary)]">
        <Lock size={11} />
        Read-only · {folder}
      </span>
      <span className="t-meta hidden text-[var(--lore-text-tertiary)] sm:inline">
        Running in your browser. Nothing is uploaded.
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onSwitch}
        className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
      >
        Switch folder
      </button>
      <button
        type="button"
        onClick={onForget}
        className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-danger)]"
      >
        Close
      </button>
      <Link
        href="/download"
        className="inline-flex h-7 items-center rounded-lg bg-[var(--lore-accent)] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
      >
        Get the app
      </Link>
    </div>
  );
}

/**
 * Naming the wiki before the picker opens.
 *
 * The name becomes the H1 of index.md and the title of AGENTS.md, so it is worth
 * asking for rather than defaulting to the folder name silently — but it is also
 * not worth blocking on, which is why the field starts filled and submitting it
 * empty is fine.
 */
function NameForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("My wiki");

  return (
    <form
      className="mt-8 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name.trim());
      }}
    >
      <label
        htmlFor="wiki-name"
        className="text-[14.5px] font-semibold text-[var(--lore-text-primary)]"
      >
        What should it be called?
      </label>
      <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">
        Next you will pick an <strong>empty folder</strong> to put it in. Lore writes five
        starter pages and five folders there — an index, a page on how to keep a wiki
        useful, a log, a worked example of a decision page, and an AGENTS.md so the first
        agent that opens it already knows the house rules.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <input
          id="wiki-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="h-11 min-w-0 flex-1 basis-56 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 text-[14.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
        />
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--lore-accent)] px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
        >
          <FolderOpen size={15} />
          Choose an empty folder
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center rounded-xl px-3 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
        >
          Cancel
        </button>
      </div>
      {/* Said here because this is the one moment the browser build asks for
          write access, and the user should know why before the prompt appears. */}
      <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
        This is the only thing Lore ever writes. After the starter pages are created the
        folder is reopened read-only, like any other wiki you open here.
      </p>
    </form>
  );
}

function Note({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        <span className="text-[var(--lore-text-tertiary)]">{icon}</span>
        {title}
      </p>
      <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">{body}</p>
    </div>
  );
}

/**
 * Turn a thrown thing into a sentence worth showing.
 *
 * The browser's own messages for this API are unusually good at saying what
 * went wrong and unusually bad at saying what to do about it, so the two named
 * cases get an answer rather than a diagnosis.
 */
function describe(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "SecurityError") {
      return "Your browser blocked the folder picker. This usually means the page is in an iframe or was opened from a file:// URL — open lore directly in a tab.";
    }
    if (error.name === "NotAllowedError") {
      return "Permission to read that folder was refused. Pick it again and choose View files when your browser asks.";
    }
    return `${error.name}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "That folder could not be opened.";
}

function toVaultIndex(index: WikiIndex): VaultIndex {
  return {
    root: index.root,
    name: index.root,
    pages: index.pages.map(({ plain: _p, frontmatter: _f, rawLinks: _r, ...meta }) => meta),
    backlinks: index.backlinks,
    tags: index.tags,
    folders: index.folders,
    errors: index.errors,
    scannedAt: index.scannedAt,
  };
}
