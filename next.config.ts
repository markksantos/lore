import type { NextConfig } from "next";

// Lore runs locally against the user's own filesystem, so the Node runtime
// (not edge) is required everywhere and there is nothing to statically export.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Electron spawns the Next server as a child process, so the build has to be
  // self-contained rather than assuming node_modules is present beside it.
  //
  // Skipped on Vercel, which does its own output tracing and has no use for a
  // standalone server directory. Leaving it on there is not fatal, but it is
  // build time spent producing an artifact nothing reads.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  serverExternalPackages: ["gray-matter"],
};

export default nextConfig;
