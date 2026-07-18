import { defineConfig, devices } from "@playwright/test";

// Mobile is the primary product surface (ADR-001): the default e2e project is a
// phone viewport, with a 320px-wide project to catch the documented minimum width.
export default defineConfig({
  testDir: "e2e",
  // Serial on purpose: e2e runs against ONE dev server backed by the
  // single-session dev PGlite and the in-process workflow dispatcher, which
  // are not built for cross-worker parallel generation load — parallel
  // workers can starve a continue-series workflow past its timeout (see
  // BUILD_STATE.md 2026-07-18 e2e-serialisation note). Wall-clock cost is
  // a few minutes; correctness beats parallelism here.
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "mobile-320",
      use: { ...devices["iPhone 14"], viewport: { width: 320, height: 568 } },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
