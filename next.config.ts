import type { NextConfig } from "next";

// Lore runs locally against the user's own filesystem, so the Node runtime
// (not edge) is required everywhere and there is nothing to statically export.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["gray-matter"],
};

export default nextConfig;
