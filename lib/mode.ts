/**
 * Which half of the product is running.
 *
 * Lore is one codebase serving two shapes: the real application, which reads
 * your filesystem and must only ever serve the machine it runs on, and the
 * public marketing site, which must have no filesystem access whatsoever.
 *
 * The inference is deliberately biased toward safety. Any recognised hosting
 * platform flips site mode ON automatically, so deploying this repo somewhere
 * without reading the docs cannot expose a filesystem — the dangerous outcome
 * requires an explicit opt-in, not merely forgetting to opt out.
 *
 * The same logic lives in proxy.ts, which is the enforcing boundary. This copy
 * exists because middleware cannot pass values into server components, and a
 * page needs to know which story to tell. Keep them in step: proxy.ts decides
 * what is *allowed*, this decides what is *shown*.
 */
export function isSiteMode(): boolean {
  if (process.env.LORE_MODE === "site") return true;
  if (process.env.LORE_MODE === "local") return false;
  return Boolean(
    process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.K_SERVICE,
  );
}
