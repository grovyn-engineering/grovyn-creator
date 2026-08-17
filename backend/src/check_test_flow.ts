import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== WORKFLOWS ===");
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

  console.log("\n=== RECENT 5 EXECUTIONS ===");
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
    inputData: ex.inputData,
    actionResults: ex.actionResults
  })), null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
