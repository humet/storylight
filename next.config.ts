import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM packages must stay out of the Server Components bundle and load
  // via native Node require, or the serverless runtime fails to resolve them
  // ("Failed to load external module …"). `pg` is auto-externalised by Next;
  // PGlite (dev/test-only DB fallback) and `sharp` (M9 image derivatives, a
  // native binary transitively wired into the services composition root) are
  // added explicitly.
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
};

export default nextConfig;
