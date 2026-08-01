import { extractArticle } from "@/lib/enrich.ts";
import { lineFrom } from "@/lib/brief.ts";

const line = (s) => console.log(s);
const show = (label, v) => console.log(`  ${label}: ${JSON.stringify(v)}`);

// ============================================================ M8 extractArticle
line("================ M8: extractArticle ================");

// (1) A ~700-char cookie-consent banner wrapped in real page chrome.
const cookieText =
  "We value your privacy. We and our partners use cookies and similar technologies to store and access information on your device. " +
  "We use cookies to personalise content and ads, to provide social media features and to analyse our traffic. " +
  "By clicking Accept All Cookies you agree to the storing of cookies on your device to enhance site navigation. " +
  "You can manage your preferences at any time by visiting our Cookie Preferences centre. See our Privacy Policy and Terms of Service for more detail. " +
  "Your consent applies to this site and its subdomains. Manage cookies below.";
const cookieHtml = `<!doctype html><html><head><title>Cookie notice</title></head><body>
<div class="cookie-banner"><p>${cookieText}</p>
<button>Accept All Cookies</button><button>Cookie Preferences</button></div>
</body></html>`;
line(`cookie banner: text length ~${cookieText.length}`);
show("extractArticle result (expect null)", extractArticle(cookieHtml));

// (2) A JS-required SPA shell with a legal footer blurb.
const jsShellHtml = `<!doctype html><html><head><title>App</title></head><body>
<div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
<p>Please enable JavaScript to continue. This application requires JavaScript.</p>
<footer><p>© 2026 Example Inc. All rights reserved. See our Privacy Policy and Terms of Service. Your continued use constitutes acceptance of our terms.</p></footer>
<script>window.__DATA__={};</script>
</body></html>`;
show("JS-shell+legal result (expect null)", extractArticle(jsShellHtml));

// (3) Control: a genuine multi-paragraph article MUST still extract.
const realHtml = `<!doctype html><html><head><title>The Coastline Problem</title>
<meta property="og:title" content="The Coastline Problem"></head><body>
<article>
<h1>The Coastline Problem</h1>
<p>The length of a coastline is not a fixed number. When you measure a rugged shore with a long ruler you get one figure, and when you measure the same shore with a short ruler you get a considerably larger one, because the shorter ruler follows more of the inlets and promontories that the long one steps across.</p>
<p>Benoit Mandelbrot made this observation the opening move of fractal geometry. The measured length grows without bound as the ruler shrinks, which means the ordinary notion of length simply does not apply to a coast in the way it applies to a straight fence.</p>
<p>What survives is a different quantity, the fractal dimension, which captures how fast the measured length grows as the ruler shrinks. A smooth curve has dimension one; the west coast of Britain sits near one and a quarter. That single number says more about the character of a coast than any length ever could.</p>
</article></body></html>`;
show("real article result (expect NON-null, no over-block)", (() => {
  const r = extractArticle(realHtml);
  return r ? { title: r.title, textLen: r.text.length, head: r.text.slice(0, 60) } : null;
})());

// ============================================================ M9/M10/M11/m1 lineFrom + clip
line("\n================ M9/M10/M11/m1: lineFrom + clip ================");

// (M9) A line whose ONLY space is at index 7 -> must NOT collapse to an 8-char stub.
const m9 = "Source: " + "x".repeat(185); // one space at index 7, total 193 chars
line(`\n[M9] input len=${m9.length}, only space at index ${m9.indexOf(" ")}`);
const m9out = lineFrom(m9);
show("output", m9out);
show("output length", m9out.length);
line(`  STUB? ${m9out.length < 20 ? "YES -> STILL OPEN" : "no -> fixed"}`);

// (M10) A 195-char line with NO spaces at all -> must not drop a char / garble.
const m10 = "A".repeat(195);
line(`\n[M10] input len=${m10.length}, spaces=${(m10.match(/ /g) || []).length}`);
const m10out = lineFrom(m10);
show("output", m10out);
show("output length", m10out.length);
line(`  ends with ellipsis? ${m10out.endsWith("…")}; hard-cut clean? ${m10out.slice(0, 179) === m10.slice(0, 179)}`);

// (M11) A markdown table row -> must NOT be emitted verbatim (collage/table leak).
const m11 = "| Role | Start Here | Output |\n|------|-----------|--------|";
line(`\n[M11] table-row-only evidence`);
const m11out = lineFrom(m11);
show("output", m11out);
line(`  table leaked? ${m11out.includes("|") ? "YES -> STILL OPEN" : "no -> fixed"}`);

// (M11b) Collage guard: title-echo + section label + table + real prose.
const m11b = [
  "# boat-rehab-tv",
  "boat-rehab-tv - Chattanooga Fiberglass / Boat Rehab TV",
  "| Role | Start Here | Output |",
  "|------|-----------|--------|",
  "Who they are",
  "They restore vintage fiberglass boats and document the full teardown on a YouTube channel that now has a large following.",
].join("\n");
line(`\n[M11b] collage-prone multi-line evidence`);
const m11bout = lineFrom(m11b);
show("output", m11bout);
line(`  collage (contains ' | ' or ' - ' title fuse)? ${/\|| - /.test(m11bout) ? "YES -> STILL OPEN" : "no -> clean prose"}`);

// (m1) MAX_RETRY_COUNT must survive unmark's underscore-emphasis strip.
const m1 = "The retry ceiling is set by MAX_RETRY_COUNT and _this_ phrase is __emphasised__ but the constant stays.";
line(`\n[m1] MAX_RETRY_COUNT + underscore emphasis`);
const m1out = lineFrom(m1);
show("output", m1out);
line(`  MAX_RETRY_COUNT intact? ${m1out.includes("MAX_RETRY_COUNT") ? "yes -> fixed" : "NO -> STILL OPEN"}`);
line(`  emphasis stripped? _this_->this=${m1out.includes("this") && !m1out.includes("_this_")}, __emphasised__->emphasised=${m1out.includes("emphasised") && !m1out.includes("__emphasised__")}`);
