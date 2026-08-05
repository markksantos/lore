import { register, startDaemon } from "@/lib/daemon";
import { isSiteMode } from "@/lib/mode";
import { sqliteAvailable } from "@/lib/signal-store";

/**
 * Every scheduled thing Lore does, declared in one place.
 *
 * Registration is separated from the features themselves so that reading this
 * file answers "what runs in the background, how often, and under whose
 * consent" without reading seven others. That question gets asked by anyone
 * deciding whether to trust this software, and it deserves a single screen of
 * answer.
 *
 * Every import is dynamic. These modules reach for SQLite, spawn `sips`, and
 * open other applications' databases; pulling them into the module graph of a
 * server that may be the public marketing site — where none of it can run and
 * all of it is bundled — is a cost with no upside.
 */

let wired = false;

export function wireObservers(): void {
  if (wired) return;
  /* The deployed site has no machine to observe and no filesystem to observe
     it with. Nothing is even registered there, so the status endpoint reports
     an empty schedule rather than a list of jobs that will never run. */
  if (isSiteMode()) return;
  if (!sqliteAvailable()) return;
  wired = true;

  // ------------------------------------------------------------------- Ghost

  /*
   * The capture interval is a user setting, so the schedule asks for it rather
   * than remembering it. The value is whatever the last `readGhostConfig` saw,
   * which the run below refreshes every tick — so a change made in the UI is
   * in effect one capture later, without a restart and without this scheduler
   * learning how to read a file.
   */
  let ghostInterval = 15_000;
  register({
    id: "ghost:capture",
    observer: "ghost",
    everyMs: () => ghostInterval,
    delayMs: 8_000,
    run: async () => {
      const { captureFrame, readGhostConfig } = await import("@/lib/ghost");
      const config = await readGhostConfig();
      ghostInterval = config.everySeconds * 1_000;
      await captureFrame(config);
    },
  });

  register({
    id: "ghost:describe",
    observer: "ghost",
    /* Slower than capture on purpose. Describing is the expensive half and the
       queue is allowed to grow: a backlog costs disk, a saturated model costs
       every other feature that needs to think. */
    everyMs: 25_000,
    delayMs: 20_000,
    run: async () => {
      const { describePending } = await import("@/lib/ghost");
      await describePending(3);
    },
  });

  register({
    id: "ghost:forget",
    observer: null,
    /*
     * Not gated on consent, deliberately.
     *
     * Retention deletes things. Skipping it while Ghost is paused would mean a
     * pause quietly extends how long the screenshots are kept, which is the
     * opposite of what pausing is for. Forgetting always runs.
     */
    everyMs: 3_600_000,
    delayMs: 60_000,
    run: async () => {
      const { forgetOldFrames } = await import("@/lib/ghost");
      await forgetOldFrames();
    },
  });

  // ------------------------------------------------------------------ Ledger

  register({
    id: "ledger:index",
    observer: "ledger",
    /* Ten minutes. Transcripts are appended to while you work, and the
       incremental pass over an unchanged corpus measured at one second against
       two thousand sessions — so this is nearly free and keeps "what did I just
       work out" answerable while it is still fresh. */
    everyMs: 600_000,
    delayMs: 45_000,
    run: async () => {
      const { reindexLedger } = await import("@/lib/ledger");
      await reindexLedger();
    },
  });

  // ------------------------------------------------------------------ Oracle

  register({
    id: "oracle:index",
    observer: "oracle",
    /*
     * Every five minutes, because each pass is BOUNDED rather than complete.
     * A decade of mail catches up over an evening in bites small enough that
     * nothing else on the machine notices, instead of one pass that pins a core
     * for twenty minutes and cannot be interrupted.
     */
    everyMs: 300_000,
    delayMs: 90_000,
    run: async () => {
      const { reindexOracle } = await import("@/lib/oracle");
      await reindexOracle();
    },
  });

  // -------------------------------------------------------------------- Twin

  register({
    id: "twin:watch",
    observer: "twin",
    /* The watcher is event-driven and long-lived; this only makes sure it is
       running and pointed at the folders currently configured. Cheap, and it is
       what re-arms observation after a pause without needing a restart. */
    everyMs: 60_000,
    delayMs: 15_000,
    run: async () => {
      const { startTwinWatcher, sampleFrontmostApp } = await import("@/lib/twin");
      await startTwinWatcher();
      await sampleFrontmostApp();
    },
  });

  register({
    id: "twin:mine",
    observer: "twin",
    /* Mining is where observations become suggestions, and a suggestion is
       worth making once an hour at most. */
    everyMs: 1_800_000,
    delayMs: 240_000,
    run: async () => {
      const { minePatterns, readTwinConfig } = await import("@/lib/twin");
      minePatterns(await readTwinConfig());
    },
  });

  register({
    id: "twin:run",
    observer: "twin",
    run: async () => {
      const { listAutomations, runAutomation } = await import("@/lib/twin");
      for (const automation of listAutomations()) {
        if (!automation.enabled) continue;
        await runAutomation(automation.id).catch(() => {});
      }
    },
    /* Two minutes. Fast enough that filing feels automatic, slow enough that a
       rule with a mistake in it moves a handful of files before you notice
       rather than a thousand. */
    everyMs: 120_000,
    delayMs: 300_000,
  });

  // ------------------------------------------------------------- Understudy

  register({
    id: "understudy:learn",
    observer: "understudy",
    /* Six hours. A voice does not change between lunch and dinner, and this
       pass reads sent mail and messages — the most expensive corpus in the
       product to walk. */
    everyMs: 6 * 3_600_000,
    delayMs: 600_000,
    run: async () => {
      const { learnVoice } = await import("@/lib/understudy");
      await learnVoice();
    },
  });

  // ---------------------------------------------------------------- Prophet

  register({
    id: "prophet:think",
    observer: "prophet",
    /*
     * Three minutes, which is set by the worst case it has to catch: a meeting
     * card is useless if it arrives after the meeting starts. Thinking is
     * arithmetic over indexes the other observers already built, so it is
     * cheap enough to do this often.
     */
    everyMs: 180_000,
    delayMs: 120_000,
    run: async () => {
      const { think } = await import("@/lib/prophet");
      await think();
    },
  });

  startDaemon();
}
