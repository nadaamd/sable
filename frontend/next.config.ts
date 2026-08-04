import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the contracts repo, so there are two lockfiles. Pin the workspace
  // root here or Turbopack infers the repo root and warns.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
