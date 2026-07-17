import { defineConfig, devices } from "@playwright/test";

// Mobile is the primary product surface (ADR-001): the default e2e project is a
// phone viewport, with a 320px-wide project to catch the documented minimum width.
export default defineConfig({
  testDir: "e2e",
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
