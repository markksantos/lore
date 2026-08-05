#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * The consent gate, which is the one thing in the observers that must not have
 * a bug.
 *
 * Six features can watch this machine and every one of them asks `mayObserve`
 * before doing anything. A fault here does not produce a wrong answer on a
 * screen — it produces a screen recorder running when somebody believed it was
 * off, which is the failure this whole subsystem exists to make impossible.
 *
 * Everything below is a pure function over a config object. No file is written
 * and the user's own ~/.lore/observers.json is never read.
 */
const { inQuietHours, mayObserve, DEFAULT_OBSERVERS, OBSERVER_IDS, OBSERVER_READS, whyNot } =
  await import("../lib/observers.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

const configWith = (patch) => ({ ...structuredClone(DEFAULT_OBSERVERS), ...patch });
const enabled = (id, patch = {}) =>
  configWith({
    observers: {
      ...structuredClone(DEFAULT_OBSERVERS.observers),
      [id]: { enabled: true, enabledAt: 1 },
    },
    ...patch,
  });

// ---------------------------------------------------------------- defaults

for (const id of OBSERVER_IDS) {
  check(`${id} is off by default`, DEFAULT_OBSERVERS.observers[id].enabled === false);
  check(
    `${id} states what it reads`,
    typeof OBSERVER_READS[id] === "string" && OBSERVER_READS[id].length > 20,
  );
}

for (const id of OBSERVER_IDS) {
  check(`${id} may not observe with the default config`, mayObserve(id, DEFAULT_OBSERVERS) === false);
}

// ------------------------------------------------------------------ pause

check("an enabled observer may observe", mayObserve("ghost", enabled("ghost")) === true);

check(
  "a live pause stops an enabled observer",
  mayObserve("ghost", enabled("ghost", { pausedUntil: Date.now() + 60_000 })) === false,
);

check(
  "an expired pause does not stop it",
  mayObserve("ghost", enabled("ghost", { pausedUntil: Date.now() - 60_000 })) === true,
);

check(
  "pause is global, not per observer",
  OBSERVER_IDS.every(
    (id) => mayObserve(id, enabled(id, { pausedUntil: Date.now() + 60_000 })) === false,
  ),
);

// ------------------------------------------------------------ quiet hours

/*
 * The wrapping window is the whole reason this function exists. 22:00-07:00 is
 * the shape everybody actually configures, and the naive `hour >= from && hour
 * < to` is false for every hour of it — so the observers would run all night
 * having been told not to.
 */
const at = (hour) => new Date(2026, 0, 15, hour, 30, 0);
const wrapping = { from: 22, to: 7 };
const daytime = { from: 9, to: 17 };

check("wrapping window: 23:30 is quiet", inQuietHours(configWith({ quietHours: wrapping }), at(23)));
check("wrapping window: 03:30 is quiet", inQuietHours(configWith({ quietHours: wrapping }), at(3)));
check(
  "wrapping window: 06:30 is quiet (the hour before `to`)",
  inQuietHours(configWith({ quietHours: wrapping }), at(6)),
);
check(
  "wrapping window: 07:30 is NOT quiet (`to` is exclusive)",
  !inQuietHours(configWith({ quietHours: wrapping }), at(7)),
);
check(
  "wrapping window: 12:30 is not quiet",
  !inQuietHours(configWith({ quietHours: wrapping }), at(12)),
);

check(
  "non-wrapping window: 12:30 is quiet",
  inQuietHours(configWith({ quietHours: daytime }), at(12)),
);
check(
  "non-wrapping window: 08:30 is not quiet",
  !inQuietHours(configWith({ quietHours: daytime }), at(8)),
);
check(
  "non-wrapping window: 17:30 is not quiet (`to` is exclusive)",
  !inQuietHours(configWith({ quietHours: daytime }), at(17)),
);

check("no quiet hours means never quiet", !inQuietHours(DEFAULT_OBSERVERS, at(3)));

// -------------------------------------------------------------- fail closed

/*
 * Anything that is not an explicit `true` means off. A hand-edited config with
 * `"enabled": "yes"` in it must not read as consent.
 */
const truthyButNotTrue = configWith({
  observers: {
    ...structuredClone(DEFAULT_OBSERVERS.observers),
    ghost: { enabled: "yes", enabledAt: 1 },
  },
});
check("a truthy non-true enabled value is not consent", mayObserve("ghost", truthyButNotTrue) === false);

const unknownObserver = mayObserve("nonexistent", DEFAULT_OBSERVERS);
check("an unknown observer id may not observe", unknownObserver === false);

// ------------------------------------------------------------------ whyNot

check("whyNot explains an off observer", (whyNot("ghost", DEFAULT_OBSERVERS) ?? "").includes("off"));
check(
  "whyNot explains a pause with a duration",
  /minute/.test(whyNot("ghost", enabled("ghost", { pausedUntil: Date.now() + 300_000 })) ?? ""),
);
check(
  "whyNot explains quiet hours with the window",
  (whyNot("ghost", enabled("ghost", { quietHours: { from: 0, to: 23 } })) ?? "").includes("Quiet hours"),
);
check("whyNot says nothing when the observer is running", whyNot("ghost", enabled("ghost")) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
