import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== LATEST EXECUTION ACTION RESULTS ===");
  const actionResults = await prisma.workflowExecutionAction.findMany({
    orderBy: { startedAt: "desc" },
    take: 3,
    include: { execution: true, action: true }
  });
  console.log(JSON.stringify(actionResults, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
