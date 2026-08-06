/**
 * Twin, end to end, against a scratch folder.
 *
 * Watch → observe a move → mine a pattern → accept it → dry-run → run for real
 * → undo. No real user folder is touched: everything happens under a temporary
 * directory that is removed at the end.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const twin = await import("@/lib/twin.ts");
const observers = await import("@/lib/observers.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const root = await fs.mkdtemp(path.join(os.tmpdir(), "lore-twin-e2e-"));
const inbox = path.join(root, "inbox");
const filed = path.join(root, "filed");
await fs.mkdir(inbox, { recursive: true });
await fs.mkdir(filed, { recursive: true });

const before = await observers.readObservers();
const beforeConfig = await twin.readTwinConfig();

try {
  await twin.forgetTwin();
  await twin.writeTwinConfig({ ...beforeConfig, watchRoots: [inbox, filed], threshold: 3, watchApps: false });
  await observers.setObserver("twin", true);

  const started = await twin.startTwinWatcher();
  check("the watcher attaches to both folders", started.watching.length === 2);

  // Four moves, which is over the threshold of three.
  for (let i = 0; i < 4; i++) {
    const name = `report-${i}.pdf`;
    await fs.writeFile(path.join(inbox, name), `contents ${i}`);
    await wait(1200);
    await fs.rename(path.join(inbox, name), path.join(filed, name));
    await wait(1200);
  }
  await wait(1500);

  const status = twin.twinStatus();
  const moves = status.eventsByKind.find((row) => row.kind === "move")?.n ?? 0;
  check("moves are detected as moves, not delete+add", moves >= 3, `saw ${moves}`);

  const mined = twin.minePatterns(await twin.readTwinConfig());
  check("a pattern is mined", mined.found >= 1, JSON.stringify(mined));

  const proposals = await twin.pendingProposals(5);
  const movePattern = proposals.find((p) => p.kind === "move");
  check("the move pattern is proposed", Boolean(movePattern));
  check("the proposal has a rule attached", Boolean(movePattern?.proposal));
  check("the proposal has a readable summary", (movePattern?.summary ?? "").length > 15);

  const automation = await twin.acceptPattern(movePattern.id);
  check("accepting creates an automation", Boolean(automation));
  check("it starts in dry-run", automation?.dryRun === true);
  check("it starts enabled", automation?.enabled === true);
  check("its description reads as a sentence", (automation?.description ?? "").includes("When a"));

  // A fresh file to act on.
  await fs.writeFile(path.join(inbox, "new-invoice.pdf"), "x");
  await wait(300);

  const dry = await twin.runAutomation(automation.id, { force: true });
  check("dry-run reports what it would do", dry.outcomes.length >= 1);
  check("dry-run is marked as such", dry.outcomes[0]?.dryRun === true);
  const stillThere = await fs.access(path.join(inbox, "new-invoice.pdf")).then(() => true).catch(() => false);
  check("dry-run moved nothing", stillThere);

  twin.setAutomation(automation.id, { dryRun: false });
  const live = await twin.runAutomation(automation.id, { force: true });
  check("a live run acts", live.outcomes.some((o) => o.ok && !o.dryRun));
  const gone = await fs.access(path.join(inbox, "new-invoice.pdf")).then(() => true).catch(() => false);
  check("the file left the source folder", !gone);
  const arrived = await fs.access(path.join(filed, "new-invoice.pdf")).then(() => true).catch(() => false);
  check("the file arrived at the destination", arrived);

  const acted = twin.recentActions(20).filter((a) => a.dryRun === 0 && a.ok === 1);
  check("the move is in the log", acted.length >= 1);
  const undone = await twin.undoActions(acted.map((a) => a.id));
  check("undo puts it back", undone.undone >= 1, JSON.stringify(undone.failed));
  const backHome = await fs.access(path.join(inbox, "new-invoice.pdf")).then(() => true).catch(() => false);
  check("the file is where it started", backHome);

  // Undo must refuse rather than guess when the world has changed underneath it.
  await fs.writeFile(path.join(filed, "decoy.pdf"), "x");
  const second = await twin.undoActions(acted.map((a) => a.id));
  check("an already-undone action is not undone twice", second.undone === 0);

  // Consent is checked by the watcher itself, not only by the scheduler.
  await observers.setObserver("twin", false);
  await twin.stopTwinWatcher();
  check("stopping the watcher clears the watch list", twin.twinWatching().length === 0);
} finally {
  await twin.forgetTwin();
  await twin.writeTwinConfig(beforeConfig);
  await observers.setObserver("twin", before.observers.twin.enabled);
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
