import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone server bundle for Docker images.
  // Hosted (Vercel) builds ignore this; self-hosted Docker images ship with it.
  output: "standalone",
  // Typecheck runs locally and in CI. Skip inside the Docker build so
  // low-RAM VPSes don't OOM/hang during `next build`.
  typescript: { ignoreBuildErrors: true },
  // fastembed loads platform-native ONNX/tokenizer binaries at runtime
  // via dynamic require(), which Turbopack can't statically resolve and
  // would warn on every per-agent file upload. Mark it as an external
  // server package so it stays a plain Node module loaded at runtime.
  serverExternalPackages: [
    "fastembed",
    "onnxruntime-node",
    "@anush008/tokenizers",
  ],
};

export default nextConfig;
