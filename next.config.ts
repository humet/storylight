import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // PGlite (the dev/test-only DB fallback) is a WASM package that must load via
  // native Node require rather than being bundled into the Server Components
  // graph. `pg` is auto-externalised by Next. (No `sharp` here — ADR-007: the
  // runtime does no image encoding, so there is no native image binary.)
  serverExternalPackages: ["@electric-sql/pglite"],
};

// Enables the "use workflow" / "use step" directives (ADR-006: Vercel Workflow
// is the durable JobDispatcher for deployed envs). On Vercel the managed
// "Vercel World" backend is provisioned automatically via OIDC — without this
// wrapper the WDK dispatcher's `start()` has no runtime and workflows are
// created but never driven (they sit `queued`).
export default withWorkflow(nextConfig);
