import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== 1. CONNECTED INSTAGRAM ACCOUNTS ===");
  const accounts = await prisma.instagramAccount.findMany();
  console.log(JSON.stringify(accounts.map(a => ({
    id: a.id,
    username: a.username,
    instagramUserId: a.instagramUserId,
    status: a.status,
    workspaceId: a.workspaceId
  })), null, 2));

  console.log("\n=== 2. WORKFLOWS ===");
  const workflows = await prisma.workflow.findMany({
    include: { conditions: true, actions: true },
  });
  console.log(JSON.stringify(workflows.map(w => ({
    id: w.id,
    name: w.name,
    status: w.status,
    triggerType: w.triggerType,
    conditions: w.conditions,
    actions: w.actions
  })), null, 2));

  console.log("\n=== 3. RECENT WEBHOOK EVENTS ===");
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(JSON.stringify(events.map(e => ({
    id: e.id,
    eventId: e.eventId,
    eventType: e.eventType,
    workspaceId: e.workspaceId,
    instagramAccountId: e.instagramAccountId,
    processed: e.processed,
    error: e.error,
    createdAt: e.createdAt,
    payload: e.payload,
    normalized: e.normalized
  })), null, 2));

  console.log("\n=== 4. RECENT WORKFLOW EXECUTIONS ===");
  const executions = await prisma.workflowExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
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
