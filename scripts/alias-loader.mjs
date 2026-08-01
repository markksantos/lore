/**
 * Resolve the `@/` path alias outside Next.js.
 *
 * The app's TypeScript is written against tsconfig's `@/*` → project root
 * mapping, which Next understands and plain Node does not. Test scripts that
 * import a lib module directly hit `Cannot find package '@/lib'` the moment
 * that module imports another one.
 *
 * Also appends `.ts`, because the source omits extensions and Node's ESM
 * resolver does not guess.
 *
 * Registered with `--import ./scripts/alias-loader.mjs`, which pairs with
 * `--experimental-strip-types` to run the real source with no build step.
 */
import { register } from "node:module";

// `import.meta.url` is already a properly encoded file: URL — running it
// through pathToFileURL again double-encodes the space in "Web Apps".
const ROOT = new URL("../", import.meta.url).href;

register(
  `data:text/javascript,
   const ROOT = ${JSON.stringify(ROOT)};
   export function resolve(specifier, context, next) {
     if (!specifier.startsWith("@/")) return next(specifier, context);
     let target = specifier.slice(2);
     if (!/\\.[a-z]+$/i.test(target)) target += ".ts";
     return next(new URL(target, ROOT).href, context);
   }`,
  import.meta.url,
);
