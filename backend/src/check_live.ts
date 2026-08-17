import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== LATEST 3 WEBHOOK EVENTS ===");
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  console.log(JSON.stringify(events, null, 2));

  console.log("\n=== LATEST 3 WORKFLOW EXECUTIONS ===");
  const executions = await prisma.workflowExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: 3,
    include: { actionResults: true },
  });
  console.log(JSON.stringify(executions, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
