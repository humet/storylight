import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Native / WASM packages must stay out of the Server Components bundle and load
  // via native Node require, or the serverless runtime fails to resolve them
  // ("Failed to load external module …"). `pg` is auto-externalised by Next;
  // PGlite (dev/test-only DB fallback) and `sharp` (M9 image derivatives, a
  // native binary transitively wired into the services composition root) are
  // added explicitly.
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  // Force sharp's native binary AND its libvips shared objects into EVERY
  // function bundle's traced output. Externalizing sharp stops Next bundling
  // its JS, but the serverless file tracer was not pulling the platform
  // `@img/sharp-libvips-linux-x64` .so into the workflow `/step` function, so
  // image jobs failed with ERR_DLOPEN (libvips cannot open shared object).
  outputFileTracingIncludes: {
    "**": ["./node_modules/@img/**", "./node_modules/sharp/**"],
  },
};

// Enables the "use workflow" / "use step" directives (ADR-006: Vercel Workflow
// is the durable JobDispatcher for deployed envs). On Vercel the managed
// "Vercel World" backend is provisioned automatically via OIDC — without this
// wrapper the WDK dispatcher's `start()` has no runtime and workflows are
// created but never driven (they sit `queued`).
export default withWorkflow(nextConfig);
