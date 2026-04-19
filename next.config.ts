import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone server bundle for Docker images.
  // Hosted (Vercel) builds ignore this; self-hosted Docker images ship with it.
  output: "standalone",
};

export default nextConfig;
