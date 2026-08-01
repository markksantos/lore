import { isPrivateHostLiteral, isPublicHost, normaliseUrl } from "@/lib/enrich.ts";

// Hosts the reviewer named. Each is tested three ways:
//  - isPrivateHostLiteral(raw)   -> string gate as called on the raw token
//  - normaliseUrl(http://host/)  -> the real string gate (strips brackets first)
//  - isPublicHost(host)          -> the DNS-resolved gate applied before fetch
// A host is FETCHABLE only if normaliseUrl returns non-null AND isPublicHost=true.

const privateHosts = [
  "[::1]",
  "0.0.0.0",
  "127.1",
  "2130706433",
  "0x7f000001",
  "169.254.169.254",
  "100.64.0.1",
  "fd00::1",
  "nas.lan",
  "localtest.me", // public name that resolves to 127.0.0.1
];

const allowedHosts = ["example.com", "8.8.8.8"];

function urlFor(host) {
  // bracket ipv6 literals for a valid URL
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${h}/path`;
}

async function probe(host) {
  const raw = isPrivateHostLiteral(host);
  let norm = null;
  try {
    norm = normaliseUrl(urlFor(host));
  } catch (e) {
    norm = `THROW:${e.message}`;
  }
  // isPublicHost is what the sweep actually calls, on new URL(candidate.url).hostname
  let hostForPublic = host;
  try {
    hostForPublic = new URL(norm ?? urlFor(host)).hostname;
  } catch {}
  let pub;
  try {
    pub = await isPublicHost(hostForPublic);
  } catch (e) {
    pub = `THROW:${e.message}`;
  }
  const blockedByString = norm === null;
  const blockedByDns = pub === false;
  const fetchable = !blockedByString && pub === true;
  return { host, raw, norm, pub, fetchable };
}

console.log("=== PRIVATE / SSRF hosts (must be UNfetchable) ===");
for (const h of privateHosts) {
  const r = await probe(h);
  console.log(
    `${r.host.padEnd(18)} literal=${String(r.raw).padEnd(5)} normaliseUrl=${String(r.norm).padEnd(28)} isPublicHost=${String(r.pub).padEnd(6)} => FETCHABLE=${r.fetchable}`,
  );
}

console.log("\n=== PUBLIC hosts (must be fetchable, no over-block) ===");
for (const h of allowedHosts) {
  const r = await probe(h);
  console.log(
    `${r.host.padEnd(18)} literal=${String(r.raw).padEnd(5)} normaliseUrl=${String(r.norm).padEnd(28)} isPublicHost=${String(r.pub).padEnd(6)} => FETCHABLE=${r.fetchable}`,
  );
}
