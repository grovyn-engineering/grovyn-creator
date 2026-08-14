import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a live database and are run by a separate config
    // so `npm test` stays fast and runnable with nothing else installed.
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
    env: {
      NODE_ENV: "test",
      // Deterministic, obviously-fake key material. These are test fixtures,
      // not credentials — the crypto tests need a valid 32-byte key and the
      // env validator refuses to load without one.
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: "dGVzdC1zZXNzaW9uLXNlY3JldC1mb3ItdW5pdC10ZXN0cy0xMjM0",
      TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      USE_MOCK_INSTAGRAM: "true",
      LOG_LEVEL: "silent",
    },
    coverage: {
      provider: "v8",
      include: ["src/engine/**", "src/utils/**", "src/modules/**/*.service.ts"],
      reporter: ["text", "html"],
    },
  },
});
