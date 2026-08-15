/**
 * Development seed.
 *
 * Creates a signed-in-able account with a connected (mock) Instagram account,
 * two workflows, and a spread of webhook events and executions across the last
 * thirty days — enough that the dashboard, the charts, and the activity page
 * all render something real rather than empty states.
 *
 * Two guarantees this script keeps:
 *
 *   - It refuses to run against a production database. Seed data is fabricated,
 *     and fabricated executions in a real workspace would corrupt the one thing
 *     this product is supposed to be trustworthy about.
 *   - It is idempotent. Running it twice does not double the data, so it can be
 *     re-run after a schema change without a reset.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { encryptToken } from "../src/utils/crypto.js";

const prisma = new PrismaClient();

const SEED_EMAIL = "demo@socialpilot.local";
const SEED_PASSWORD = "demo-password";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");

  /*
   * The target is printed rather than pattern-matched against localhost.
   *
   * An earlier version required the host to look local, which was correct when
   * the database ran in Docker and is wrong now: the development database is a
   * hosted Supabase project, so a "must be local" check would reject every
   * legitimate use. A hostname is no longer a proxy for "safe to overwrite".
   *
   * NODE_ENV remains the hard gate. Naming the host makes an accidental
   * production URL visible in the output rather than silent.
   */
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "unparseable";
    }
  })();

  console.log(`Target database: ${host}`);
  if (!/localhost|127\.0\.0\.1/.test(host)) {
    console.log("  (remote database — make sure this is your development project)\n");
  }

  console.log("Seeding development data…\n");

  const passwordHash = await hash(SEED_PASSWORD, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: { email: SEED_EMAIL, name: "Demo Owner", passwordHash },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-studio" },
    update: {},
    create: {
      name: "Demo Studio",
      slug: "demo-studio",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  // A mock-shaped account. The token is a placeholder, not a real credential —
  // the mock provider never sends it anywhere.
  const account = await prisma.instagramAccount.upsert({
    where: { instagramUserId: "mock_seed_account" },
    // The token is refreshed on update too, not just on create. Leaving it out
    // meant re-seeding kept whatever was already stored — so an account left
    // EXPIRED by a failed decrypt stayed broken no matter how many times the
    // seed was re-run.
    update: {
      workspaceId: workspace.id,
      status: "ACTIVE",
      accessTokenEncrypted: encryptToken("mock-seed-access-token"),
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    },
    create: {
      workspaceId: workspace.id,
      instagramUserId: "mock_seed_account",
      username: "demo_studio",
      displayName: "Demo Studio",
      status: "ACTIVE",
      /*
       * A fake token, but genuinely encrypted with the real routine.
       *
       * An earlier version stored a plain placeholder string, on the theory
       * that anything trying to use it should fail loudly. It did fail loudly —
       * `getAccessTokenFor` could not decrypt it, marked the account EXPIRED,
       * and every seeded workflow then refused to run. That defeats the point
       * of the mock provider, which exists so the whole pipeline works without
       * Meta credentials.
       *
       * The value is still meaningless: the mock provider never sends it
       * anywhere, and the real provider would be rejected by Meta immediately.
       */
      accessTokenEncrypted: encryptToken("mock-seed-access-token"),
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });

  const priceWorkflow = await upsertWorkflow(workspace.id, {
    name: "Auto-reply to price questions",
    description: "Answers the question that gets asked twenty times a day.",
    status: "ACTIVE",
    triggerType: "COMMENT_RECEIVED",
    conditions: [{ field: "comment.text", operator: "contains", value: "price" }],
    actions: [
      {
        actionType: "REPLY_TO_COMMENT",
        configuration: { message: "Just sent you a DM with the details, {{username}}!" },
      },
      {
        actionType: "SEND_DIRECT_MESSAGE",
        configuration: { message: "Hi {{username}} — here's the pricing you asked about." },
      },
    ],
  });

  const welcomeWorkflow = await upsertWorkflow(workspace.id, {
    name: "Welcome new DMs",
    description: "A first reply so nobody waits on a human.",
    status: "PAUSED",
    triggerType: "MESSAGE_RECEIVED",
    conditions: [],
    actions: [
      {
        actionType: "SEND_DIRECT_MESSAGE",
        configuration: { message: "Thanks for reaching out! We reply within a few hours." },
      },
    ],
  });

  await seedHistory(workspace.id, account.id, priceWorkflow.id, priceWorkflow.actionIds);

  console.log(`  user        ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  workspace   ${workspace.name}`);
  console.log(`  instagram   @${account.username} (mock)`);
  console.log(`  workflows   ${priceWorkflow.name}, ${welcomeWorkflow.name}`);
  console.log("\nDone. Sign in at http://localhost:3000/login\n");
}

async function upsertWorkflow(
  workspaceId: string,
  input: {
    name: string;
    description: string;
    status: "ACTIVE" | "PAUSED" | "DRAFT";
    triggerType: "COMMENT_RECEIVED" | "MESSAGE_RECEIVED" | "MENTION_RECEIVED";
    conditions: Array<{ field: string; operator: Prisma.WorkflowConditionCreateManyInput["operator"]; value: string }>;
    actions: Array<{ actionType: "REPLY_TO_COMMENT" | "SEND_DIRECT_MESSAGE" | "LIKE_COMMENT"; configuration: object }>;
  }
): Promise<{ id: string; name: string; actionIds: string[] }> {
  const existing = await prisma.workflow.findFirst({
    where: { workspaceId, name: input.name },
    include: { actions: true },
  });

  if (existing) {
    return { id: existing.id, name: existing.name, actionIds: existing.actions.map((a) => a.id) };
  }

  const created = await prisma.workflow.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description,
      status: input.status,
      triggerType: input.triggerType,
      conditions: {
        create: input.conditions.map((condition, position) => ({ ...condition, position })),
      },
      actions: {
        create: input.actions.map((action, position) => ({
          actionType: action.actionType,
          configuration: action.configuration as Prisma.InputJsonValue,
          position,
        })),
      },
    },
    include: { actions: true },
  });

  return { id: created.id, name: created.name, actionIds: created.actions.map((a) => a.id) };
}

/**
 * Thirty days of plausible traffic.
 *
 * Volume varies by day and the failure rate is low but non-zero, so the charts
 * show shape rather than a flat line, and the "failed" tile has something to
 * report. Skipped runs are included because they are the common real case — a
 * comment arrives, the condition does not match, nothing happens — and the
 * dashboard needs to render that honestly.
 */
async function seedHistory(
  workspaceId: string,
  instagramAccountId: string,
  workflowId: string,
  actionIds: string[]
): Promise<void> {
  const existing = await prisma.workflowExecution.count({ where: { workspaceId } });
  if (existing > 0) {
    console.log("  history     already present, skipping");
    return;
  }

  const samples = [
    { text: "how much is the price?", matches: true },
    { text: "what's the price on this?", matches: true },
    { text: "love this!", matches: false },
    { text: "price please 🙏", matches: true },
    { text: "where do you ship?", matches: false },
    { text: "is this still available", matches: false },
  ];

  const now = Date.now();

  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    // A weekly rhythm plus noise, rather than uniform volume.
    const weekday = new Date(now - daysAgo * 86_400_000).getUTCDay();
    const base = weekday === 0 || weekday === 6 ? 1 : 3;
    const count = Math.max(0, base + Math.floor(Math.random() * 3) - 1);

    for (let index = 0; index < count; index += 1) {
      const sample = samples[Math.floor(Math.random() * samples.length)]!;
      const occurredAt = new Date(
        now - daysAgo * 86_400_000 + index * 3_600_000 + Math.floor(Math.random() * 3_000_000)
      );

      const commentId = `seed_${randomUUID()}`;
      const normalized = {
        eventId: `ig:comment:${commentId}`,
        platform: "INSTAGRAM",
        eventType: "COMMENT",
        recipientAccountId: "mock_seed_account",
        occurredAt: occurredAt.toISOString(),
        payload: {
          type: "COMMENT",
          commentId,
          postId: `seed_post_${index % 4}`,
          text: sample.text,
          author: { id: `seed_user_${index}`, username: `visitor_${index}` },
        },
      };

      const event = await prisma.webhookEvent.create({
        data: {
          eventId: normalized.eventId,
          workspaceId,
          instagramAccountId,
          eventType: "COMMENT",
          payload: { object: "instagram", entry: [] } as Prisma.InputJsonValue,
          normalized: normalized as unknown as Prisma.InputJsonValue,
          processed: true,
          processedAt: occurredAt,
          createdAt: occurredAt,
        },
      });

      // Roughly one in fourteen matched runs fails, which is about what a real
      // integration against a rate-limited API looks like.
      const failed = sample.matches && Math.random() < 0.07;
      const status = !sample.matches ? "SKIPPED" : failed ? "FAILED" : "SUCCESS";

      const execution = await prisma.workflowExecution.create({
        data: {
          workflowId,
          workspaceId,
          webhookEventId: event.id,
          status,
          mode: "LIVE",
          skipReason: sample.matches ? null : 'comment.text does not contain "price".',
          error: failed ? "Instagram is rate limiting this account. Try again shortly." : null,
          inputData: normalized as unknown as Prisma.InputJsonValue,
          startedAt: occurredAt,
          completedAt: new Date(occurredAt.getTime() + 400 + Math.floor(Math.random() * 900)),
        },
      });

      if (sample.matches) {
        await prisma.workflowExecutionAction.createMany({
          data: actionIds.map((actionId, position) => ({
            executionId: execution.id,
            actionId,
            actionType: position === 0 ? ("REPLY_TO_COMMENT" as const) : ("SEND_DIRECT_MESSAGE" as const),
            status: failed && position === 1 ? ("FAILED" as const) : ("SUCCESS" as const),
            externalId: failed && position === 1 ? null : `seed_result_${randomUUID()}`,
            error: failed && position === 1 ? "Instagram is rate limiting this account." : null,
            position,
            startedAt: occurredAt,
            completedAt: new Date(occurredAt.getTime() + 500),
          })),
        });
      }
    }
  }

  const total = await prisma.workflowExecution.count({ where: { workspaceId } });
  console.log(`  history     ${total} executions over 30 days`);
}

main()
  .catch((error: unknown) => {
    console.error("\nSeed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
