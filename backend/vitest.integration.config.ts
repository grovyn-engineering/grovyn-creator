import { defineConfig } from "vitest/config";

/**
 * Integration tests. Separate from the unit config because these need a live
 * Postgres, which `npm test` must not require — a contributor should be able to
 * run the unit suite with nothing installed.
 *
 *   npm run infra:up
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Sequential. These share one database, and parallel files would truncate
    // tables out from under each other.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://socialpilot:socialpilot@localhost:5432/socialpilot_test?schema=public",
      SESSION_SECRET: "dGVzdC1zZXNzaW9uLXNlY3JldC1mb3ItdW5pdC10ZXN0cy0xMjM0",
      TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      USE_MOCK_INSTAGRAM: "true",
      LOG_LEVEL: "silent",
      // Unset so the webhook path processes inline; a queued test would need a
      // worker running and would be timing-dependent.
      REDIS_URL: "",
    },
  },
});
