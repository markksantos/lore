import { chromium } from "playwright";
const O = "/private/tmp/claude-501/-Users-markksantos/df2b9137-f870-4ea2-ba75-3c84b5900005/scratchpad/shots";
const b = await chromium.launch({ headless: true });
const errors = [];
for (const [name, dark] of [["n-landing-full", false], ["n-landing-full-dark", true]]) {
  const p = await b.newPage({ viewport:{width:1440,height:900}, colorScheme:dark?"dark":"light", deviceScaleFactor:1 });
  p.on("pageerror", e => errors.push(`${name}: ${e.message.slice(0,120)}`));
  p.on("console", m => { if (m.type()==="error") errors.push(`${name}: ${m.text().slice(0,120)}`); });
  await p.goto("http://localhost:4747/", { waitUntil:"networkidle" });
  await p.waitForTimeout(900);
  await p.screenshot({ path:`${O}/${name}.png`, fullPage:true });
  await p.close();
}
for (const w of [375, 768]) {
  const p = await b.newPage({ viewport:{width:w,height:812} });
  await p.goto("http://localhost:4747/", { waitUntil:"networkidle" });
  const o = await p.evaluate(() => ({s:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
  console.log(`${w}px ${o.s>o.c?"H-OVERFLOW":"ok"}`);
  await p.close();
}
console.log(errors.length ? "ERRORS:\n"+errors.join("\n") : "no console errors");
await b.close();
