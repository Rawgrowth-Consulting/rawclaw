import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone server bundle for Docker images.
  // Hosted (Vercel) builds ignore this; self-hosted Docker images ship with it.
  output: "standalone",
  // Pin the workspace root so Turbopack stops walking up to /home/pedroafonso
  // and printing the "multiple lockfiles" warning every dev boot. Pedro has
  // an unrelated package-lock.json in $HOME from another project — without
  // this pin, Turbopack treated $HOME as workspace root and resolved every
  // package import from /home/pedroafonso/node_modules (which doesn't have
  // tailwindcss installed), causing "Module not found" on dev boot.
  // Hardcoded absolute path is the only reliable signal here; process.cwd()
  // is wrong when next is invoked from a parent shell with a different cwd,
  // and __dirname is ESM-undefined.
  turbopack: { root: "/home/pedroafonso/rawclaw-research/rawclaw" },
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
