import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real stack: Bun server + SQLite file + built admin SPA.
 * The webServer boots on a fresh database each run, so specs can assume the
 * first-run setup screen. Build the SPA first (bun run build).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1, // one shared server + database; specs run serially
  use: {
    baseURL: "http://localhost:3999",
    trace: "retain-on-failure",
    // Point PW_CHROMIUM_PATH at a Chromium binary to skip the managed
    // download (useful in sandboxes/CI images with a preinstalled browser).
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Fresh throwaway database per run; the Bun server also serves ../dist.
    command:
      "rm -f /tmp/opencms-e2e.db* && OPENCMS_DB=/tmp/opencms-e2e.db OPENCMS_PORT=3999 BETTER_AUTH_SECRET=e2e-secret-not-for-production-0123456789 bun run ../dev/index.ts",
    url: "http://localhost:3999/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
