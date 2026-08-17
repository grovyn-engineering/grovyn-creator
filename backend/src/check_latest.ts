import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== LATEST 3 WEBHOOK EVENTS ===");
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  console.log(JSON.stringify(events.map(e => ({
    id: e.id,
    eventId: e.eventId,
    eventType: e.eventType,
    workspaceId: e.workspaceId,
    processed: e.processed,
    error: e.error,
    createdAt: e.createdAt,
    payload: e.payload,
    normalized: e.normalized
  })), null, 2));

  console.log("\n=== LATEST 3 EXECUTIONS ===");
  const executions = await prisma.workflowExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: 3,
    include: { actionResults: true },
  });
  console.log(JSON.stringify(executions.map(ex => ({
    id: ex.id,
    workflowId: ex.workflowId,
    status: ex.status,
    skipReason: ex.skipReason,
    error: ex.error,
    startedAt: ex.startedAt,
    inputData: ex.inputData,
    actionResults: ex.actionResults
  })), null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
