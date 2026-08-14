import { execSync } from "node:child_process";

/**
 * Creates and migrates the test database once per run.
 *
 * A dedicated database rather than the development one: these tests truncate
 * tables between cases, and pointing them at a database with real work in it
 * would delete it.
 */
export default function globalSetup(): void {
  const url = process.env.DATABASE_URL;

  if (!url) throw new Error("DATABASE_URL is not set for integration tests");

  // Guard against a misconfigured CI pointing this at something real.
  if (!/localhost|127\.0\.0\.1|postgres:/.test(url) || !url.includes("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${url.replace(/:[^:@]+@/, ":***@")}" — ` +
        "the database name must contain _test and the host must be local."
    );
  }

  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
