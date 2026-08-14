import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../config/prisma.js";
import {
  commentWebhook,
  connectAccount,
  signUp,
  testApp,
  waitForProcessing,
} from "../../test/helpers.js";

/**
 * The end-to-end backend journey: webhook in, workflow executed, dashboard
 * updated — plus the idempotency guarantee that makes the whole thing safe to
 * expose to a service that redelivers.
 */
describe("webhook to execution", () => {
  async function setup(conditionValue = "price") {
    const { agent, workspaceId } = await signUp();
    const account = await connectAccount(workspaceId);

    const created = await agent
      .post("/api/workflows")
      .set("X-Workspace-Id", workspaceId)
      .send({
        name: "Auto-reply to price questions",
        triggerType: "COMMENT_RECEIVED",
        conditions: [{ field: "comment.text", operator: "contains", value: conditionValue }],
        actions: [
          { actionType: "REPLY_TO_COMMENT", configuration: { message: "Hi {{username}}!" } },
        ],
      })
      .expect(201);

    const workflowId = created.body.data.workflow.id as string;

    await agent
      .post(`/api/workflows/${workflowId}/enable`)
      .set("X-Workspace-Id", workspaceId)
      .expect(200);

    return { agent, workspaceId, account, workflowId };
  }

  it("answers the verification handshake with the challenge", async () => {
    const response = await request(testApp())
      .get("/api/webhooks/instagram")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
        "hub.challenge": "1158201444",
      });

    // Without a configured verify token the handshake must fail closed.
    if (process.env.META_WEBHOOK_VERIFY_TOKEN) {
      expect(response.status).toBe(200);
      expect(response.text).toBe("1158201444");
    } else {
      expect(response.status).toBe(403);
    }
  });

  it("rejects a wrong verify token", async () => {
    await request(testApp())
      .get("/api/webhooks/instagram")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "definitely-wrong",
        "hub.challenge": "123",
      })
      .expect(403);
  });

  it("persists the event and executes a matching workflow", async () => {
    const { workspaceId, account, workflowId } = await setup();

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: account.instagramUserId, text: "what is the price?" }))
      .expect(200);

    await waitForProcessing(
      async () => (await prisma.workflowExecution.count({ where: { workspaceId } })) > 0
    );

    const execution = await prisma.workflowExecution.findFirst({
      where: { workspaceId },
      include: { actionResults: true },
    });

    expect(execution?.workflowId).toBe(workflowId);
    expect(execution?.status).toBe("SUCCESS");
    expect(execution?.actionResults).toHaveLength(1);
    expect(execution?.actionResults[0]?.status).toBe("SUCCESS");
  });

  it("records a SKIPPED execution with a reason when conditions do not match", async () => {
    const { workspaceId, account } = await setup("price");

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: account.instagramUserId, text: "love this!" }))
      .expect(200);

    await waitForProcessing(
      async () => (await prisma.workflowExecution.count({ where: { workspaceId } })) > 0
    );

    const execution = await prisma.workflowExecution.findFirst({ where: { workspaceId } });

    // A non-match still gets a row. Recording only the runs that fired leaves a
    // user asking "why didn't my workflow do anything?" with nothing to look at.
    expect(execution?.status).toBe("SKIPPED");
    expect(execution?.skipReason).toContain("comment.text");
    expect(await prisma.workflowExecutionAction.count()).toBe(0);
  });

  it("deduplicates a redelivered event", async () => {
    const { workspaceId, account } = await setup();
    const payload = commentWebhook({
      recipientAccountId: account.instagramUserId,
      commentId: "c_stable_id",
      text: "what is the price?",
    });

    await request(testApp()).post("/api/webhooks/instagram").send(payload).expect(200);
    await waitForProcessing(
      async () => (await prisma.workflowExecution.count({ where: { workspaceId } })) > 0
    );

    // Byte-identical redelivery, exactly as Meta sends after a failed ack.
    await request(testApp()).post("/api/webhooks/instagram").send(payload).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.webhookEvent.count({ where: { workspaceId } })).toBe(1);
    // The important assertion: the customer's followers do not get two replies.
    expect(await prisma.workflowExecution.count({ where: { workspaceId } })).toBe(1);
  });

  it("derives the same event id regardless of when it arrives", async () => {
    const { account } = await setup();

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: account.instagramUserId, commentId: "c_abc" }))
      .expect(200);

    const event = await prisma.webhookEvent.findFirst();
    expect(event?.eventId).toBe("ig:comment:c_abc");
  });

  it("stores an event for an unknown account without executing anything", async () => {
    await setup();

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: "an_account_we_do_not_know" }))
      .expect(200);

    await waitForProcessing(async () => (await prisma.webhookEvent.count()) > 0);

    const event = await prisma.webhookEvent.findFirst({
      where: { eventId: { contains: "comment" } },
      orderBy: { createdAt: "desc" },
    });

    // Stored rather than dropped, so "we received it and could not route it" is
    // distinguishable from "it never arrived".
    expect(event?.workspaceId).toBeNull();
    expect(await prisma.workflowExecution.count()).toBe(0);
  });

  it("does not run a disabled workflow", async () => {
    const { agent, workspaceId, account, workflowId } = await setup();

    await agent
      .post(`/api/workflows/${workflowId}/disable`)
      .set("X-Workspace-Id", workspaceId)
      .expect(200);

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: account.instagramUserId }))
      .expect(200);

    await waitForProcessing(async () => (await prisma.webhookEvent.count()) > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.workflowExecution.count({ where: { workspaceId } })).toBe(0);
  });

  it("reflects executions in the dashboard", async () => {
    const { agent, workspaceId, account } = await setup();

    await request(testApp())
      .post("/api/webhooks/instagram")
      .send(commentWebhook({ recipientAccountId: account.instagramUserId, text: "the price?" }))
      .expect(200);

    await waitForProcessing(
      async () => (await prisma.workflowExecution.count({ where: { workspaceId } })) > 0
    );

    const dashboard = await agent
      .get("/api/dashboard")
      .set("X-Workspace-Id", workspaceId)
      .expect(200);

    expect(dashboard.body.data.summary.executions.total.value).toBe(1);
    expect(dashboard.body.data.summary.executions.succeeded.value).toBe(1);
    expect(dashboard.body.data.summary.events.comments.value).toBe(1);
    expect(dashboard.body.data.summary.instagram.isConnected).toBe(true);

    const activity = await agent
      .get("/api/dashboard/activity")
      .set("X-Workspace-Id", workspaceId)
      .expect(200);

    expect(activity.body.data.activity).toHaveLength(1);
    expect(activity.body.data.activity[0].summary).toContain("curious_buyer");
  });

  it("excludes test runs from dashboard figures", async () => {
    const { agent, workspaceId, workflowId } = await setup();

    await agent
      .post(`/api/workflows/${workflowId}/test`)
      .set("X-Workspace-Id", workspaceId)
      .send({ sample: { text: "what is the price?", authorUsername: "tester", postId: "p1" } })
      .expect(200);

    expect(await prisma.workflowExecution.count({ where: { mode: "DRY_RUN" } })).toBe(1);

    const dashboard = await agent
      .get("/api/dashboard")
      .set("X-Workspace-Id", workspaceId)
      .expect(200);

    // Counting dry runs would let a user inflate their own success rate by
    // pressing Test, and make the dashboard disagree with reality.
    expect(dashboard.body.data.summary.executions.total.value).toBe(0);
  });

  it("refuses to enable a workflow with no connected Instagram account", async () => {
    const { agent, workspaceId } = await signUp();

    const created = await agent
      .post("/api/workflows")
      .set("X-Workspace-Id", workspaceId)
      .send({
        name: "Orphan workflow",
        triggerType: "COMMENT_RECEIVED",
        conditions: [],
        actions: [{ actionType: "REPLY_TO_COMMENT", configuration: { message: "hi" } }],
      })
      .expect(201);

    const response = await agent
      .post(`/api/workflows/${created.body.data.workflow.id}/enable`)
      .set("X-Workspace-Id", workspaceId)
      .expect(409);

    // Enabling one with nothing feeding it would leave it looking live forever.
    expect(response.body.error.code).toBe("ACCOUNT_UNAVAILABLE");
  });
});
