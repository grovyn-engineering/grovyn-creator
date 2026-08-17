import { prisma } from "./config/prisma.js";

async function main() {
  console.log("Enabling RLS on exact PostgreSQL snake_case table names...");
  const tables = [
    "_prisma_migrations",
    "users",
    "sessions",
    "workspaces",
    "workspace_members",
    "instagram_accounts",
    "workflows",
    "workflow_conditions",
    "workflow_actions",
    "webhook_events",
    "workflow_executions",
    "workflow_execution_actions",
    "audit_logs",
    "oauth_states",
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "${table}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`RLS Enabled on table: "${table}"`);
    } catch (err) {
      console.error(`Failed on "${table}":`, err);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
