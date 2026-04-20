import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone server bundle for Docker images.
  // Hosted (Vercel) builds ignore this; self-hosted Docker images ship with it.
  output: "standalone",
  // Typecheck + lint run locally and in CI. Skip inside the Docker build so
  // low-RAM VPSes don't OOM/hang during `next build`.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
