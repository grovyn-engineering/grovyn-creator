import { prisma } from "./config/prisma.js";

async function main() {
  const accounts = await prisma.instagramAccount.findMany();
  console.log("=== INSTAGRAM ACCOUNTS IN DB ===");
  console.log(JSON.stringify(accounts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
