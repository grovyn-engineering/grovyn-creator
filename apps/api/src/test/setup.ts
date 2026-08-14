import { afterAll, beforeEach } from "vitest";
import { prisma } from "../config/prisma.js";

/**
 * A clean database before every test.
 *
 * `TRUNCATE ... CASCADE` rather than deleting per table in dependency order:
 * it is one statement, it does not care about foreign key ordering, and
 * `RESTART IDENTITY` resets sequences so ids do not drift across a run.
 *
 * Truncating is also why these tests run sequentially — parallel files would
 * empty tables out from under each other.
 */
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_logs",
      "workflow_execution_actions",
      "workflow_executions",
      "webhook_events",
      "workflow_actions",
      "workflow_conditions",
      "workflows",
      "oauth_states",
      "instagram_accounts",
      "workspace_members",
      "workspaces",
      "sessions",
      "users"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
