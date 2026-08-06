/**
 * The consent file under concurrent writes.
 *
 * Two mutators interleaving is not hypothetical: the menu-bar tray pauses
 * everything while the settings screen toggles an observer. Read-modify-write
 * on one file loses whichever finished first, and the setting most likely to be
 * lost is the pause — the one where losing a write means something keeps
 * watching after being told to stop.
 */
const observers = await import("@/lib/observers.ts");
const before = await observers.readObservers();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

try {
  await observers.pauseAll(0);
  for (const id of observers.OBSERVER_IDS) await observers.setObserver(id, false);

  /* Six toggles and a pause, all launched together. */
  await Promise.all([
    ...observers.OBSERVER_IDS.map((id) => observers.setObserver(id, true)),
    observers.pauseAll(30),
  ]);

  const after = await observers.readObservers();
  const enabled = observers.OBSERVER_IDS.filter((id) => after.observers[id].enabled);
  check("every concurrent toggle survived", enabled.length === 6, `${enabled.length} of 6`);
  check("the concurrent pause survived", after.pausedUntil !== null);
  check(
    "and the pause still gates them",
    observers.OBSERVER_IDS.every((id) => !observers.mayObserve(id, after)),
  );
} finally {
  await observers.pauseAll(0);
  for (const id of observers.OBSERVER_IDS) {
    await observers.setObserver(id, before.observers[id].enabled);
  }
  if (before.pausedUntil) await observers.pauseAll(Math.round((before.pausedUntil - Date.now()) / 60_000));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
