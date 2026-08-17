import { prisma } from "./config/prisma.js";
import { getAccessTokenFor } from "./modules/instagram/instagram.token.service.js";
import { getProvider } from "./modules/instagram/instagram.provider.js";

async function main() {
  const account = await prisma.instagramAccount.findFirst({
    where: { username: "rakessh57582" },
  });

  if (!account) {
    console.error("Account rakessh57582 not found!");
    return;
  }

  console.log("Found account:", account.username, "ID:", account.id, "IG User ID:", account.instagramUserId);
  const accessToken = await getAccessTokenFor(account.id);

  console.log("Calling subscribeToWebhooks against Meta Graph API...");
  try {
    await getProvider().subscribeToWebhooks({ accessToken });
    console.log("SUCCESS: Meta accepted subscribed_apps for comments, messages, mentions!");
  } catch (error) {
    console.error("FAILED to subscribe webhooks:", error);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
