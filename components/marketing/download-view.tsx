"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download as DownloadIcon, ShieldAlert } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { CodeBlock } from "@/components/marketing/code-block";
import { DOWNLOADS, GITHUB_URL, RELEASES_URL, RELEASE_TAG, type Download } from "@/lib/brand";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The download page.
 *
 * Its shape depends on whether a release exists. With `RELEASES_URL` set — as it
 * is now — the detected platform is listed first with a real download button and
 * the others follow. Set it back to null and the page falls back to building
 * from source rather than showing buttons that would 404.
 *
 * Either way the honest part stays visible. These builds are unsigned, and a
 * user who hits Gatekeeper with no warning concludes the app is malware rather
 * than that its author has not paid Apple $99.
 */

type OS = Download["os"] | null;

/**
 * Best-effort, and only used to reorder the page — never to hide anything.
 * `userAgentData` is Chromium-only and `platform` is deprecated but universally
 * present, so try the good one and fall back. A wrong guess costs a scroll; a
 * guess that hid the right build would cost the download.
 */
function detectOS(): OS {
  if (typeof navigator === "undefined") return null;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const raw = `${hinted ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (raw.includes("mac")) return "macOS";
  if (raw.includes("win")) return "Windows";
  if (raw.includes("linux") || raw.includes("x11")) return "Linux";
  return null;
}

/* The real marks, as on the landing page. A fruit outline and a terminal prompt
   are drawings of the idea of a computer; someone scanning for their platform is
   looking for a logo, not reading. */
const OS_MARK = {
  macOS: "/assets/platforms/apple.svg",
  Windows: "/assets/platforms/windows.svg",
  Linux: "/assets/platforms/linux.svg",
} as const;

function PlatformMark({ os, size = 16 }: { os: Download["os"]; size?: number }) {
  return (
    <img
      src={OS_MARK[os]}
      alt=""
      width={size}
      height={size}
      className={cn(
        "shrink-0 opacity-70 dark:brightness-0 dark:invert",
        os === "Linux" && "scale-[1.15]",
      )}
      style={{ width: size, height: size }}
    />
  );
}
const OS_ORDER: Download["os"][] = ["macOS", "Windows", "Linux"];

export function DownloadView() {
  const [os, setOs] = useState<OS>(null);

  // After mount only: the server has no idea what machine is asking, and
  // rendering a guess would hydrate into a different one.
  useEffect(() => setOs(detectOS()), []);

  const ordered = [...OS_ORDER].sort((a, b) => (a === os ? -1 : b === os ? 1 : 0));

  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-32 md:px-8">
        <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
          Download
        </p>
        <h1 className="t-section mt-3 text-[var(--lore-text-primary)]">
          Lore, in a window.
        </h1>
        <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
          The same application as the browser version, with a native folder picker and no
          terminal. It runs a local server on your own machine and talks to nothing else —
          the desktop build is a window onto <code>127.0.0.1</code>, not a client for a
          service.
        </p>

        {/* Before the installers, because it is the shortest honest path to
            someone's own wiki: no download, no build step, no account. */}
        <section className="mt-8 rounded-2xl border border-[var(--lore-accent)]/35 bg-[var(--lore-surface)] p-5">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            Nothing to install
          </h2>
          <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">
            Lore can open your markdown folder straight from a browser tab, reading it off
            your disk with nothing uploaded. Read-only, no account, and it works today in
            Chrome, Edge, Arc and Brave. The download below adds the watcher, page history,
            the MCP server your agents connect to, local AI, and phone access.
          </p>
          <Link
            href="/web"
            className="mt-3.5 inline-flex h-9 items-center rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
          >
            Open your wiki in the browser
          </Link>
        </section>

        {RELEASES_URL ? <Releases os={os} ordered={ordered} /> : <BuildFromSource os={os} />}

        <section className="mt-14">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            Or run it from source
          </h2>
          <p className="t-body mt-2 max-w-2xl text-[var(--lore-text-secondary)]">
            Lore is a web app that runs on your own machine, so you can skip the installer and
            use it in the browser you already have. The desktop build exists for the folder
            picker and the dock icon, not for any capability the browser version lacks — on
            macOS the picker works in a browser tab too.
          </p>
          <div className="mt-4">
            <CodeBlock
              label="Terminal"
              lines={[`git clone ${GITHUB_URL}.git`, "cd lore", "npm install", "npm run dev"]}
            />
            <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
              Opens on <code>127.0.0.1:4646</code>. It binds to loopback deliberately, so nothing
              else on your network can reach your wiki through it. Node 20.9 or newer; nothing
              else.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/web"
              className="inline-flex h-10 items-center rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
            >
              Open your wiki in the browser
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center rounded-xl border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              Source on GitHub
            </a>
          </div>
        </section>

        <Signing />

        <section className="mt-14">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            What you need
          </h2>
          <ul className="lore-bullets mt-3 space-y-2 text-[15px] leading-[1.7] text-[var(--lore-text-secondary)]">
            <li>
              A folder of markdown. An Obsidian vault, a <code>notes/</code> directory,
              anything — Lore reads it in place and never reorganises it.
            </li>
            <li>
              Node 20.9 or newer, to run from source. The desktop build bundles its own
              runtime and needs nothing installed.
            </li>
            <li>
              No account, no database, no API key. There is nothing to sign up for because
              there is nowhere to sign up to.
            </li>
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            What it never does
          </h2>
          <ul className="lore-bullets mt-3 space-y-2 text-[15px] leading-[1.7] text-[var(--lore-text-secondary)]">
            <li>Upload your wiki, or any part of it, anywhere.</li>
            <li>Listen on anything but loopback.</li>
            <li>
              Move, rename or reformat your files. The one file it can add is{" "}
              <code>AGENTS.md</code>, fenced so anything you wrote in it is preserved.
            </li>
            <li>
              Keep state inside your vault. Config, the write journal and Lore's own bookkeeping all live
              in <code>~/.lore</code>, so a <code>git diff</code> of your notes stays clean.
            </li>
          </ul>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

/** Rendered once a release exists. Kept whole so turning it on is one constant. */
function Releases({ os, ordered }: { os: OS; ordered: Download["os"][] }) {
  return (
    <div className="mt-10 space-y-8">
      {ordered.map((group, i) => {
        const builds = DOWNLOADS.filter((d) => d.os === group);
        return (
          <section key={group} style={paletteVars(i * 3)}>
            <div className="flex items-center gap-2.5">
              <PlatformMark os={group} />
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
                {group}
              </h2>
              {group === os ? (
                <span className="pal-chip rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold">
                  your machine
                </span>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              {builds.map((build) => (
                <div
                  key={build.asset}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3"
                >
                  <span className="text-[14px] font-medium text-[var(--lore-text-primary)]">
                    {build.label}
                  </span>
                  <span className="flex-1" />
                  {build.blocked ? (
                    <span className="t-meta text-[var(--lore-text-tertiary)]">
                      {build.blocked}
                    </span>
                  ) : (
                    <a
                      href={`${RELEASES_URL}/download/${RELEASE_TAG}/${build.asset}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
                    >
                      <DownloadIcon size={13} />
                      Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The state today: no published release, so point at the thing that works. */
function BuildFromSource({ os }: { os: OS }) {
  const command =
    os === "Windows" ? "npm run dist:win" : os === "Linux" ? "npm run dist:linux" : "npm run dist:mac";

  return (
    <div className="mt-9">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5">
        <ShieldAlert size={17} className="mt-0.5 shrink-0 text-[var(--lore-text-tertiary)]" />
        <div>
          <p className="t-body text-[var(--lore-text-primary)]">
            There is no published installer yet.
          </p>
          <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
            Signed builds need an Apple Developer membership and a Windows certificate, and
            neither is set up. Rather than ship something your OS will flag as unidentified,
            the build is one command away and produces exactly the same application.
          </p>
        </div>
      </div>

      <section style={paletteVars(0)} className="mt-8">
        <h2 className="pal-title text-[18px] font-semibold tracking-[-0.02em]">
          Build it yourself
        </h2>
        <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">
          Four commands{os ? ` — the last one is the ${os} build` : ""}. Takes a couple of
          minutes, most of it <code>npm install</code>.
        </p>
        <div className="mt-3.5">
          <CodeBlock
            label="Terminal"
            lines={[`git clone ${GITHUB_URL}.git`, "cd lore", "npm install", command]}
          />
        </div>
        <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
          The installer lands in <code>dist-desktop/</code>. Swap the last command for{" "}
          <code>npm run dev</code> to skip packaging and use it in the browser instead.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          What each platform produces
        </h2>
        <div className="mt-3.5 space-y-2">
          {OS_ORDER.map((group) => {
            const builds = DOWNLOADS.filter((d) => d.os === group);
            return (
              <div
                key={group}
                className={cn(
                  "rounded-xl border border-[var(--lore-border)] px-4 py-3.5",
                  group === os ? "bg-[var(--lore-surface)]" : "bg-transparent",
                )}
              >
                <div className="flex items-center gap-2">
                  <PlatformMark os={group} size={15} />
                  <span className="text-[14.5px] font-medium text-[var(--lore-text-primary)]">
                    {group}
                  </span>
                  {group === os ? (
                    <span className="t-meta text-[var(--lore-text-tertiary)]">
                      · your machine
                    </span>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1">
                  {builds.map((build) => (
                    <li
                      key={build.asset}
                      className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-[var(--lore-text-secondary)]"
                    >
                      <span
                        className="text-[12.5px] text-[var(--lore-text-tertiary)]"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        {build.asset}
                      </span>
                      {build.blocked ? (
                        <span className="t-meta text-[var(--lore-text-tertiary)]">
                          — {build.blocked}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
          AppImage has to be assembled on Linux — the bundled <code>mksquashfs</code> is a
          Linux binary, so a Mac cannot produce one.
        </p>
      </section>
    </div>
  );
}

function Signing() {
  return (
    <section className="mt-14">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        About the security warning
      </h2>
      <p className="t-body mt-2 max-w-2xl text-[var(--lore-text-secondary)]">
        Whatever you build is unsigned, and your operating system will say so. That warning
        means nobody paid to have the binary notarised — it is not a judgement about the
        code, and it is worth knowing the difference before you click through it.
      </p>
      <ul className="lore-bullets mt-3 space-y-2 text-[15px] leading-[1.7] text-[var(--lore-text-secondary)]">
        <li>
          <strong>macOS</strong>{" "}
          <span>
            refuses it on first launch. Open System Settings → Privacy &amp; Security and
            choose <em>Open Anyway</em>.
          </span>
        </li>
        <li>
          <strong>Windows</strong> shows a SmartScreen panel. <em>More info</em> → <em>Run
          anyway</em>.
        </li>
        <li>
          <strong>Linux</strong> needs the AppImage marked executable —{" "}
          <code>chmod +x Lore-*.AppImage</code>.
        </li>
      </ul>
      <p className="t-body mt-3 max-w-2xl text-[var(--lore-text-secondary)]">
        If that trade is not one you want to make, run it from source instead. You get to
        read every line first, which is the stronger guarantee anyway.
      </p>
    </section>
  );
}
