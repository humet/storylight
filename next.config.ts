import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native/WASM database drivers out of the Server Components bundle and
  // use native Node require. `pg` is already auto-externalised by Next; PGlite
  // (the dev/test-only fallback) is added explicitly.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
