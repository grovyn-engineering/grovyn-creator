import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * These drive a real browser against a real API and a real database, so they
 * are the only tests that prove the whole journey works — everything else
 * verifies a layer in isolation.
 *
 * Prerequisites, since these cannot be faked:
 *   npm run infra:up
 *   npm run db:migrate
 *   npm run dev          (or set E2E_BASE_URL at an already-running instance)
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Sequential. The journey signs up, creates workspace state, and posts
  // webhooks; parallel workers would interleave and make assertions unreliable.
  fullyParallel: false,
  workers: 1,
  // Fail the CI run if a `.only` was committed.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL,
    // Kept only for failures — a trace per passing test is a lot of disk for
    // nothing.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The layout is a drawer rather than a squeezed sidebar below `lg`, which
    // is different enough code to be worth exercising.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  // Only started when nothing is already listening, so a developer's running
  // `npm run dev` is reused rather than fought over.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev --workspace @socialpilot/web",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: "../..",
      },
});
