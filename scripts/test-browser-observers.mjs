#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * What the browser build says about the observers.
 *
 * Five of the seven cannot run in a tab and one genuinely can. Both halves of
 * that are claims the landing page and the documentation make, so both are
 * pinned here — a 501 that quietly became a 200 with an empty array would read
 * to a user as "you have no conversations", which is a lie about their data.
 *
 * The shim is exercised through the same `fetch("/api/…")` the components use,
 * because that is the whole point of its design.
 */
/*
 * The shim only intercepts same-origin /api paths, which it decides by reading
 * `location`. Node has none, so one is provided — this is the browser contract
 * being tested, not a workaround for it.
 */
globalThis.location = new URL("http://localhost/vault");

const { installBrowserApi, uninstallBrowserApi, isBrowserVault } = await import(
  "../lib/browser-api.ts"
);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

/* A vault of three pages with a consistent, terse voice, so the measurements
   have something real to measure. */
const page = (id, relPath, title, plain) => ({
  id, relPath, title, plain,
  folder: "", words: plain.split(/\s+/).length, mtime: 1_700_000_000_000,
  tags: [], links: [], rawLinks: [], frontmatter: {}, headings: [],
});

const index = {
  root: "/scratch",
  pages: [
    page("a", "a.md", "One", "Sent it. Let me know. I've pushed the fix and it's live, so you're clear to test it now. Didn't touch the pricing logic at all, and I won't until Thursday."),
    page("b", "b.md", "Two", "Quick one. I'll turn it round same day. That's still on me for Thursday, so don't worry about chasing it up again this week or the next one."),
    page("c", "c.md", "Three", "Done. It's all deployed. You're good to go, and I'll follow up on Friday if anything looks off to you at all, so don't hesitate to shout."),
    page("d", "d.md", "Short", "ok thanks"),
  ],
  backlinks: {}, tags: {}, folders: [{ folder: "", count: 3, total: 3 }],
  errors: [], scannedAt: 1_700_000_000_000,
};

check("nothing is installed to begin with", isBrowserVault() === false);

installBrowserApi({
  index,
  texts: new Map(index.pages.map((p) => [p.relPath, p.plain])),
  name: "scratch",
  handle: /** a stand-in; the observer paths never touch it */ ({}),
  rescan: async () => {},
  forget: async () => {},
});

try {
  check("the shim reports itself installed", isBrowserVault() === true);

  // ------------------------------------------------------- desktop-only five
  for (const [route, expect] of [
    ["/api/ghost", /screen/i],
    ["/api/ledger", /disk|transcript/i],
    ["/api/oracle", /permission|macOS/i],
    ["/api/twin", /read-only|move/i],
    ["/api/prophet", /observers/i],
    ["/api/chorus", /keys|proxy/i],
  ]) {
    const response = await fetch(`http://localhost${route}`);
    const body = await response.json();
    check(`${route} refuses with 501`, response.status === 501, `got ${response.status}`);
    check(`${route} says it is a desktop feature`, body.desktopOnly === true);
    check(`${route} explains why a tab cannot`, expect.test(body.error ?? ""), body.error);
  }

  // ------------------------------------------------------------- observers
  const observers = await (await fetch("http://localhost/api/observers")).json();
  check("/api/observers answers rather than refusing", Array.isArray(observers.observers));
  check("it lists all six", observers.observers.length === 6);
  check("all six are off", observers.observers.every((o) => o.enabled === false));
  check(
    "each says why it cannot run here",
    observers.observers.every((o) => /browser tab/i.test(o.blockedBecause ?? "")),
  );
  check("the daemon is reported as not started", observers.daemon.started === false);

  // ------------------------------------------------------------- understudy
  const understudy = await (await fetch("http://localhost/api/understudy")).json();
  check("/api/understudy answers for real", understudy.browser === true);
  check("it measured the pages", understudy.profile?.overall.samples === 3, `samples ${understudy.profile?.overall.samples}`);
  check("the measurements are non-trivial", understudy.profile.overall.words > 40);
  check(
    "it measured the terse voice as terse",
    understudy.profile.overall.sentenceMedian <= 12,
    `median ${understudy.profile?.overall.sentenceMedian}`,
  );
  check(
    "it noticed the contractions",
    understudy.profile.overall.contractionRate > 0.5,
    `rate ${understudy.profile?.overall.contractionRate}`,
  );
  check("the brief is the same text the model would get", typeof understudy.brief === "string");
  check("the brief states the median", understudy.brief.includes("median"));
  check(
    "drafting is reported as unavailable, with a reason",
    understudy.localModel.state === "unsupported" && /machine/.test(understudy.localModel.detail),
  );

  const drafting = await fetch("http://localhost/api/understudy", { method: "POST", body: "{}" });
  const draftBody = await drafting.json();
  check("drafting refuses with 501", drafting.status === 501);
  check("and says the measurements here were real", /measured your voice here/i.test(draftBody.error));

  // A page with no prose must not be counted as a writing sample.
  /* The fourth page is two words. Both builds use the same word floor, so it
     must not appear in either corpus. */
  check(
    "a page below the word floor is excluded",
    understudy.profile.overall.samples === index.pages.length - 1,
  );
} finally {
  uninstallBrowserApi();
}

check("uninstalling clears the flag", isBrowserVault() === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
