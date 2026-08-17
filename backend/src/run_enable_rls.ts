import { prisma } from "./config/prisma.js";

async function main() {
  console.log("Enabling Row Level Security (RLS) on all Supabase tables...");
  const tables = [
    "User",
    "Session",
    "Workspace",
    "WorkspaceMember",
    "InstagramAccount",
    "Workflow",
    "WorkflowExecution",
    "WorkflowExecutionAction",
    "WebhookEvent",
    "AuditLog",
    "OAuthState",
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "${table}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`RLS Enabled on table: "${table}"`);
    } catch (err) {
      console.error(`Failed to enable RLS on "${table}":`, err);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
