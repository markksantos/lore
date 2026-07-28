"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, FolderOpen, Loader2, Lock, Monitor } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { VaultApp } from "@/components/lore/vault-app";
import {
  SUPPORTED,
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
    const handle = await pickFolder();
    if (handle) await load(handle);
  }

  async function regrant() {
    const saved = await restoreFolder();
    if (!saved) return setStage({ kind: "idle" });
    if (await requestAccess(saved.handle)) await load(saved.handle);
    else setStage({ kind: "idle" });
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
          Point this page at the folder your markdown already lives in. It reads the files
          straight off your disk — nothing is uploaded, there is no account, and this page
          does not talk to a server again after it loads.
        </p>

        <Body stage={stage} onChoose={choose} onRegrant={regrant} />

        <div className="mt-10 grid gap-3 border-t border-[var(--lore-border)] pt-8 sm:grid-cols-2">
          <Note
            icon={<Lock size={14} />}
            title="Read-only, enforced by the browser"
            body="The folder is opened for reading only, so a write is refused below this code. Sign-offs are stored in this browser, not in your files."
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
}: {
  stage: Stage;
  onChoose: () => void;
  onRegrant: () => void;
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
        <p className="flex items-center gap-2 text-[14.5px] text-[var(--lore-danger)]">
          <AlertTriangle size={15} />
          {stage.message}
        </p>
        <button type="button" onClick={onChoose} className={button}>
          <FolderOpen size={16} />
          Try another folder
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={onChoose} className={button}>
      <FolderOpen size={16} />
      Choose your wiki folder
    </button>
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
