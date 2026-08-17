import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== CONNECTED INSTAGRAM ACCOUNTS ===");
  const accounts = await prisma.instagramAccount.findMany();
  console.log(JSON.stringify(accounts.map(a => ({
    id: a.id,
    username: a.username,
    instagramUserId: a.instagramUserId,
    status: a.status,
    connectedAt: a.connectedAt,
    updatedAt: a.updatedAt
  })), null, 2));

  console.log("\n=== LATEST 5 WEBHOOK EVENTS ===");
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log(JSON.stringify(events.map(e => ({
    id: e.id,
    eventId: e.eventId,
    eventType: e.eventType,
    workspaceId: e.workspaceId,
    processed: e.processed,
    error: e.error,
    createdAt: e.createdAt,
    normalized: e.normalized
  })), null, 2));

  console.log("\n=== LATEST 5 WORKFLOW EXECUTIONS ===");
  const executions = await prisma.workflowExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    include: { actionResults: true },
  });
  console.log(JSON.stringify(executions.map(ex => ({
    id: ex.id,
    workflowId: ex.workflowId,
    status: ex.status,
    skipReason: ex.skipReason,
    error: ex.error,
    startedAt: ex.startedAt,
    actionResults: ex.actionResults
  })), null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
