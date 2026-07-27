import type { NextConfig } from "next";

// Lore runs locally against the user's own filesystem, so the Node runtime
// (not edge) is required everywhere and there is nothing to statically export.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Electron spawns the Next server as a child process, so the build has to be
  // self-contained rather than assuming node_modules is present beside it.
  output: "standalone",
  serverExternalPackages: ["gray-matter"],
};

export default nextConfig;
