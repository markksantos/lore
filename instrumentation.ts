/**
 * Process-level safety, loaded once at boot by Next.
 *
 * Two jobs, both born from a nine-reviewer load test: a rejection nobody
 * caught must not kill a server no operator is watching, and the first request
 * should not pay the index-parse boot cost (measured at 30.1s by a reviewer
 * whose first request it was). The implementation lives in
 * instrumentation-node.ts; this file only routes by runtime, because the edge
 * compilation rejects Node APIs statically.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
