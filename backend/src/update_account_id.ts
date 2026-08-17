import { prisma } from "./config/prisma.js";

async function main() {
  console.log("Updating rakessh57582 instagramUserId to 17841443698226711...");
  const updated = await prisma.instagramAccount.updateMany({
    where: { username: "rakessh57582" },
    data: { instagramUserId: "17841443698226711" },
  });

  console.log("Updated accounts count:", updated.count);

  const account = await prisma.instagramAccount.findFirst({
    where: { username: "rakessh57582" },
  });

  console.log("Updated account row:", JSON.stringify(account, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
