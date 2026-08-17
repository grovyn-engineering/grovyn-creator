import { prisma } from "./config/prisma.js";

async function main() {
  console.log("=== RECENT AUDIT LOGS ===");
  const auditLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(JSON.stringify(auditLogs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
