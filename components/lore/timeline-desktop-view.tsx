"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookPlus, Camera, Loader2, Monitor, Search } from "lucide-react";
import { cn, count, relativeTime } from "@/lib/utils";

/**
 * Timeline — your screen, as a record you can ask questions of.
 *
 * The data comes from the DesktopRecord app's local store, read-only: frames,
 * OCR, activity blocks, and per-block notes a local model wrote. This screen
 * is the scrubber over it — pick a day, see what the machine saw, search the
 * text of everything that has ever been on screen, and file a day into the
 * wiki so Ask can answer "what was I doing Tuesday afternoon?".
 *
 * One deliberate absence: nothing here auto-plays or auto-loads frames beyond
 * the selected moment. Screen history is the most sensitive data on the
 * machine, and a screen that eagerly fans out screenshots is a screen nobody
 * opens while sharing their display. Frames load one moment at a time, on an
 * explicit click.
 */

type Status = {
  installed: boolean;
  recording: boolean;
  captures: number;
  days: number;
  newestAt: number | null;
  oldestAt: number | null;
};

type Block = {
  uuid: string;
  start: number;
  end: number;
  apps: string[];
  titles: string[];
  urls: string[];
  captureCount: number;
  representative: string | null;
  note: { summary: string; facts: string[]; openThreads: string[] } | null;
};

type Capture = {
  uuid: string;
  at: number;
  app: string;
  title: string;
  url: string | null;
  ocrExcerpt: string;
};

type ScreenHit = { at: number; app: string; title: string; snippet: string; uuid: string };

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function TimelineDesktopView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<{ blocks: Block[]; captures: Capture[] } | null>(null);
  const [selected, setSelected] = useState<Block | null>(null);
  const [frame, setFrame] = useState<Capture | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ScreenHit[] | null>(null);
  const [filing, setFiling] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/timeline", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const loadDay = useCallback(async (target: string) => {
    setData(null);
    setSelected(null);
    setFrame(null);
    const noon = Date.parse(`${target}T12:00:00`);
    const response = await fetch(`/api/timeline?at=${noon}&window=720`, {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response?.ok) return setData({ blocks: [], captures: [] });
    const parsed = (await response.json()) as { blocks: Block[]; captures: Capture[] };
    setData({ blocks: parsed.blocks, captures: parsed.captures });
  }, []);

  useEffect(() => {
    if (status?.installed) loadDay(day);
  }, [status?.installed, day, loadDay]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return setHits(null);
    const response = await fetch(`/api/timeline?screen=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    setHits(response?.ok ? ((await response.json()) as { results: ScreenHit[] }).results : []);
  }, [query]);

  const fileDay = useCallback(async () => {
    setFiling("…");
    const response = await fetch("/api/timeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "file", day }),
    }).catch(() => null);
    const body = response?.ok ? await response.json() : null;
    setFiling(body?.ok ? `Filed as timeline/${day}.md` : (body?.reason ?? "Could not file."));
  }, [day]);

  /** Where each block sits on the 24-hour strip. */
  const strip = useMemo(() => {
    if (!data) return [];
    const dayStart = Date.parse(`${day}T00:00:00`);
    return data.blocks.map((block) => ({
      block,
      left: Math.max(0, ((block.start - dayStart) / 86_400_000) * 100),
      width: Math.max(0.4, ((block.end - block.start) / 86_400_000) * 100),
    }));
  }, [data, day]);

  const capturesInSelected = useMemo(() => {
    if (!data || !selected) return [];
    return data.captures.filter((c) => c.at >= selected.start && c.at <= selected.end);
  }, [data, selected]);

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
            Timeline
          </h1>
          <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
            {status.installed
              ? status.recording
                ? `Recording. ${count(status.captures, "frame")} across ${count(status.days, "day")}, all on this machine.`
                : status.captures
                  ? `Not currently recording — last frame ${status.newestAt ? relativeTime(status.newestAt) : "unknown"}. Open DesktopRecord to resume.`
                  : "DesktopRecord is set up but has not captured anything yet. Open it and grant Screen Recording."
              : "Your screen, as a record you can ask questions of — powered by the DesktopRecord app."}
          </p>
        </div>
        {status.installed ? (
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="shrink-0 self-start rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 py-1.5 text-[13px] text-[var(--lore-text-primary)] outline-none"
          />
        ) : null}
      </header>

      {!status.installed ? (
        <div className="rounded-xl border border-dashed border-[var(--lore-border)] px-5 py-8">
          <p className="text-[14px] leading-relaxed text-[var(--lore-text-secondary)]">
            The recorder is a native app: screenshots when the screen changes, OCR on
            device, activity blocks summarised by a local model. Nothing is uploaded
            anywhere — the store lives in your own Application Support folder, and Lore
            only ever reads it.
          </p>
          <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
            Install DesktopRecord, launch it, and grant Screen Recording in System
            Settings → Privacy &amp; Security. This screen lights up on its own once
            frames exist.
          </p>
        </div>
      ) : (
        <>
          {/* ------------------------------------------------- screen search */}
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--lore-text-tertiary)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
                if (e.key === "Escape") {
                  setQuery("");
                  setHits(null);
                }
              }}
              placeholder="Search everything that has been on your screen"
              className="w-full rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] py-2.5 pl-9 pr-3 text-[13.5px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-text-tertiary)]"
            />
          </div>

          {hits !== null ? (
            <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
              {hits.length ? (
                hits.slice(0, 15).map((hit) => (
                  <button
                    key={hit.uuid}
                    type="button"
                    onClick={() => {
                      const hitDay = new Date(hit.at).toISOString().slice(0, 10);
                      setHits(null);
                      setQuery("");
                      setDay(hitDay);
                    }}
                    className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
                  >
                    <span className="block text-[13.5px] text-[var(--lore-text-primary)]">
                      {hit.snippet || hit.title}
                    </span>
                    <span className="t-meta text-[var(--lore-text-tertiary)]">
                      {hit.app} · {new Date(hit.at).toLocaleString()}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-4 py-5 text-center text-[13px] text-[var(--lore-text-tertiary)]">
                  Nothing on any screen matched that.
                </p>
              )}
            </div>
          ) : null}

          {/* -------------------------------------------------- the day strip */}
          {data === null ? (
            <div className="mt-6 flex items-center gap-2.5 text-[13px] text-[var(--lore-text-tertiary)]">
              <Loader2 size={14} className="animate-spin" /> Reading the day…
            </div>
          ) : !data.blocks.length ? (
            <p className="mt-6 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
              Nothing recorded on {day}.
            </p>
          ) : (
            <>
              <div className="relative mt-6 h-9 overflow-hidden rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)]">
                {strip.map(({ block, left, width }) => (
                  <button
                    key={block.uuid}
                    type="button"
                    onClick={() => {
                      setSelected(block);
                      setFrame(null);
                    }}
                    title={`${hhmm(block.start)}–${hhmm(block.end)}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className={cn(
                      "absolute top-1 bottom-1 rounded-sm transition-colors",
                      selected?.uuid === block.uuid
                        ? "bg-[var(--lore-accent)]"
                        : "bg-[var(--lore-surface-raised)] hover:bg-[var(--lore-border)]",
                    )}
                  />
                ))}
                {[6, 12, 18].map((h) => (
                  <span
                    key={h}
                    style={{ left: `${(h / 24) * 100}%` }}
                    className="t-meta pointer-events-none absolute bottom-0.5 -translate-x-1/2 text-[9px] text-[var(--lore-text-tertiary)]"
                  >
                    {h}:00
                  </span>
                ))}
              </div>

              {/* ------------------------------------------------ block list */}
              <div className="mt-4 space-y-2">
                {data.blocks.map((block) => (
                  <div
                    key={block.uuid}
                    className={cn(
                      "rounded-xl border bg-[var(--lore-surface)] px-4 py-3 transition-colors",
                      selected?.uuid === block.uuid
                        ? "border-[var(--lore-accent)]"
                        : "border-[var(--lore-border)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(selected?.uuid === block.uuid ? null : block);
                        setFrame(null);
                      }}
                      className="block w-full text-left"
                    >
                      <span className="t-meta text-[var(--lore-text-tertiary)]">
                        {hhmm(block.start)}–{hhmm(block.end)} ·{" "}
                        {block.apps.map((a) => a.split(".").pop()).join(", ") || "screen"} ·{" "}
                        {count(block.captureCount, "frame")}
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-[1.55] text-[var(--lore-text-primary)]">
                        {block.note?.summary ?? block.titles.filter(Boolean)[0] ?? "Activity"}
                      </span>
                    </button>

                    {selected?.uuid === block.uuid ? (
                      <div className="mt-2.5 border-t border-[var(--lore-border)] pt-2.5">
                        {block.note?.facts.length ? (
                          <ul className="t-meta mb-2 list-disc space-y-0.5 pl-4 text-[var(--lore-text-secondary)]">
                            {block.note.facts.slice(0, 5).map((fact, i) => (
                              <li key={i}>{fact}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="flex flex-wrap gap-1.5">
                          {capturesInSelected.slice(0, 10).map((capture) => (
                            <button
                              key={capture.uuid}
                              type="button"
                              onClick={() => setFrame(frame?.uuid === capture.uuid ? null : capture)}
                              className={cn(
                                "t-meta inline-flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors",
                                frame?.uuid === capture.uuid
                                  ? "border-[var(--lore-accent)] text-[var(--lore-text-primary)]"
                                  : "border-[var(--lore-border)] text-[var(--lore-text-tertiary)] hover:text-[var(--lore-text-primary)]",
                              )}
                            >
                              <Camera size={10} />
                              {hhmm(capture.at)}
                            </button>
                          ))}
                        </div>
                        {frame ? (
                          <figure className="mt-2.5">
                            {/* Served by uuid through the containment check; a
                                plain img tag because this is a same-origin,
                                auth-guarded route, not a remote asset. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/timeline/frame?uuid=${encodeURIComponent(frame.uuid)}`}
                              alt={`${frame.app} at ${hhmm(frame.at)}`}
                              className="max-h-[420px] w-full rounded-lg border border-[var(--lore-border)] object-contain"
                            />
                            <figcaption className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
                              {frame.app} · {frame.title} · {hhmm(frame.at)}
                              {frame.url ? ` · ${frame.url}` : ""}
                            </figcaption>
                          </figure>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* ---------------------------------------------- file the day */}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={fileDay}
                  className="t-meta inline-flex items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
                >
                  <BookPlus size={12} />
                  File this day into the wiki
                </button>
                {filing ? (
                  <span className="t-meta text-[var(--lore-text-tertiary)]">{filing}</span>
                ) : (
                  <span className="t-meta text-[var(--lore-text-tertiary)]">
                    Writes timeline/{day}.md — prose only, screenshots stay here.
                  </span>
                )}
              </div>
            </>
          )}

          <p className="t-meta mt-6 flex items-start gap-2 text-[var(--lore-text-tertiary)]">
            <Monitor size={12} className="mt-0.5 shrink-0" />
            Everything on this screen is read from DesktopRecord&rsquo;s local store.
            Nothing is uploaded, and the wiki only ever receives prose you chose to file.
          </p>
        </>
      )}
    </div>
  );
}
