import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mayObserve, readObserversSync, type ObserverId } from "@/lib/observers";

/**
 * The background loop.
 *
 * Six observers need to do something on a schedule — photograph a screen,
 * re-index a folder, notice that a meeting starts in twenty minutes — and none
 * of them can wait for the user to open a tab. So there is one loop, here,
 * inside the Next server process that is already running for the app's sake.
 *
 * Deliberately NOT a separate daemon process. A second process is a second
 * thing to install, supervise, update, kill on uninstall and explain in a
 * support thread — and its only advantage is surviving the app being closed,
 * which for a tool that watches your screen is a liability rather than a
 * feature. Quitting Lore should stop Lore watching. It does.
 *
 * Four rules hold the whole thing together:
 *
 *   CONSENT IS CHECKED PER TICK, not per registration. A job that was allowed
 *   when it was scheduled must not run because of that; it asks again, every
 *   time, so the pause switch takes effect within one tick.
 *
 *   A JOB CANNOT OVERLAP ITSELF. Indexing eighty thousand emails takes longer
 *   than the interval, and a second pass starting on top of the first is how a
 *   background task becomes a fork bomb.
 *
 *   FAILURE BACKS OFF. A job that throws waits progressively longer, so a
 *   missing permission produces a line in a log rather than a thousand lines a
 *   minute for the rest of the day.
 *
 *   NOTHING THROWS OUT OF HERE. An unhandled rejection in a background timer
 *   takes the whole server with it under Node's defaults, and the server is
 *   also the user's wiki.
 */

const DIR = path.join(os.homedir(), ".lore");
const LOG = path.join(DIR, "daemon.log");

export type Job = {
  id: string;
  /** The observer whose consent gates this job; null for jobs that watch nothing. */
  observer: ObserverId | null;
  /**
   * Target gap between runs.
   *
   * A function when the user owns the number. Ghost's capture interval is a
   * setting, and a value read once at registration would mean changing it in
   * the UI did nothing until the app was restarted — the kind of bug that gets
   * reported as "the slider doesn't work".
   */
  everyMs: number | (() => number);
  /** Skip the first run until this long after boot, so start-up stays quiet. */
  delayMs?: number;
  run: () => Promise<void>;
};

/** The interval this job wants right now, clamped away from the absurd. */
function intervalOf(job: Job): number {
  const raw = typeof job.everyMs === "function" ? job.everyMs() : job.everyMs;
  return Number.isFinite(raw) ? Math.min(86_400_000, Math.max(1_000, raw)) : 60_000;
}

type JobState = {
  job: Job;
  timer: NodeJS.Timeout | null;
  running: boolean;
  failures: number;
  lastRunAt: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runs: number;
};

const jobs = new Map<string, JobState>();
let started = false;

async function log(line: string): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    await appendFile(LOG, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* A log that cannot be written must not stop the work it describes. */
  }
}

/**
 * Spread the jobs out.
 *
 * Six observers registered at boot with round-number intervals all fire on the
 * same second forever, which turns a machine that is 3% busy on average into
 * one that stalls for two seconds every minute. Ten per cent of jitter is
 * enough to decorrelate them and small enough that no interval is meaningfully
 * changed.
 */
const jitter = (ms: number) => ms + Math.floor(Math.random() * ms * 0.1);

function schedule(state: JobState, delay: number): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => void tick(state), delay);
  /* Unref'd: a pending observer tick must never be the reason a process
     refuses to exit when the user quits. */
  state.timer.unref?.();
}

async function tick(state: JobState): Promise<void> {
  const { job } = state;
  if (state.running) {
    schedule(state, jitter(intervalOf(job)));
    return;
  }

  /* Asked fresh every tick — this is what makes pausing immediate. A job whose
     observer is off still keeps its timer, so re-enabling it needs no restart:
     it simply starts doing work again on its next tick. */
  if (job.observer && !mayObserve(job.observer)) {
    schedule(state, jitter(intervalOf(job)));
    return;
  }

  state.running = true;
  const startedAt = Date.now();
  try {
    await job.run();
    state.failures = 0;
    state.lastError = null;
  } catch (error) {
    state.failures += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
    /* Logged only for the first few. A permission that will never be granted
       should cost a handful of lines, not a log file that fills a disk. */
    if (state.failures <= 3) await log(`job ${job.id} failed: ${state.lastError}`);
  } finally {
    state.running = false;
    state.lastRunAt = Date.now();
    state.lastDurationMs = Date.now() - startedAt;
    state.runs += 1;
  }

  /* Exponential backoff to a ten-minute ceiling. Far enough to stop a broken
     job costing anything, near enough that a fixed permission is picked up
     without the user restarting anything. */
  const every = intervalOf(job);
  const backoff = state.failures
    ? Math.min(every * 2 ** Math.min(state.failures, 5), 600_000)
    : every;
  schedule(state, jitter(backoff));
}

export function register(job: Job): void {
  const existing = jobs.get(job.id);
  if (existing) {
    /* Dev's hot reload re-runs module initialisers. Replacing the definition
       and keeping the single timer is the difference between one loop and one
       loop per save. */
    existing.job = job;
    return;
  }
  const state: JobState = {
    job,
    timer: null,
    running: false,
    failures: 0,
    lastRunAt: null,
    lastError: null,
    lastDurationMs: null,
    runs: 0,
  };
  jobs.set(job.id, state);
  if (started) schedule(state, job.delayMs ?? 1_000);
}

/**
 * Bring the loop up.
 *
 * Called from instrumentation, which Next runs once per server process, and
 * again (harmlessly) by any route that wants to be sure. Registration is
 * separate from starting so a job can be declared at import time and only
 * begin once the process has decided it is the kind of process that observes.
 */
export function startDaemon(): void {
  if (started) return;
  started = true;
  for (const state of jobs.values()) schedule(state, state.job.delayMs ?? 1_000);
  void log(`daemon started with ${jobs.size} job${jobs.size === 1 ? "" : "s"}`);
}

export function stopDaemon(): void {
  started = false;
  for (const state of jobs.values()) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }
}

/**
 * Run one job right now, outside its schedule.
 *
 * Every observer's settings screen has a "run it now" button, because the gap
 * between switching something on and seeing it do anything is otherwise up to
 * an hour of wondering whether it works. Consent is still checked; this is a
 * shortcut through the timer, not through the gate.
 */
export async function runNow(id: string): Promise<{ ok: boolean; error?: string }> {
  const state = jobs.get(id);
  if (!state) return { ok: false, error: `No job named ${id}.` };
  if (state.running) return { ok: false, error: "That job is already running." };
  if (state.job.observer && !mayObserve(state.job.observer)) {
    return { ok: false, error: `${state.job.observer} is not currently allowed to run.` };
  }
  state.running = true;
  try {
    await state.job.run();
    state.failures = 0;
    state.lastError = null;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    state.failures += 1;
    return { ok: false, error: message };
  } finally {
    state.running = false;
    state.lastRunAt = Date.now();
    state.runs += 1;
  }
}

export type JobStatus = {
  id: string;
  observer: ObserverId | null;
  everyMs: number;
  running: boolean;
  allowed: boolean;
  runs: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  failures: number;
};

export function daemonStatus(): { started: boolean; jobs: JobStatus[] } {
  const config = readObserversSync();
  return {
    started,
    jobs: [...jobs.values()].map((state) => ({
      id: state.job.id,
      observer: state.job.observer,
      everyMs: intervalOf(state.job),
      running: state.running,
      allowed: state.job.observer ? mayObserve(state.job.observer, config) : true,
      runs: state.runs,
      lastRunAt: state.lastRunAt,
      lastDurationMs: state.lastDurationMs,
      lastError: state.lastError,
      failures: state.failures,
    })),
  };
}
