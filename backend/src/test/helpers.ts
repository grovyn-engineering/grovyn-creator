import request, { type Agent } from "supertest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { prisma } from "../config/prisma.js";
import { encryptToken } from "../utils/crypto.js";

let app: Express | null = null;

export function testApp(): Express {
  app ??= createApp();
  return app;
}

/**
 * A signed-up user with a session cookie already held.
 *
 * Returns a supertest agent rather than a raw token because the agent persists
 * cookies across requests, which is exactly how a browser behaves — and it
 * means these tests exercise the real cookie path rather than a header shortcut
 * that production never uses.
 */
export async function signUp(
  overrides: { email?: string; name?: string; password?: string; workspaceName?: string } = {}
): Promise<{
  agent: Agent;
  userId: string;
  workspaceId: string;
  email: string;
}> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@test.local`;
  const password = overrides.password ?? "test-password-1";

  const agent = request.agent(testApp());

  const response = await agent
    .post("/api/auth/signup")
    .send({
      name: overrides.name ?? "Test User",
      email,
      password,
      ...(overrides.workspaceName ? { workspaceName: overrides.workspaceName } : {}),
    })
    .expect(201);

  return {
    agent,
    userId: response.body.data.user.id as string,
    workspaceId: response.body.data.activeWorkspaceId as string,
    email,
  };
}

/**
 * Attaches a connected Instagram account directly.
 *
 * Written through Prisma rather than driven through OAuth because the OAuth
 * flow is tested separately, and every other test only needs the connection to
 * exist.
 */
export async function connectAccount(
  workspaceId: string,
  instagramUserId = `ig_${Math.random().toString(36).slice(2, 10)}`
): Promise<{ id: string; instagramUserId: string }> {
  const account = await prisma.instagramAccount.create({
    data: {
      workspaceId,
      instagramUserId,
      username: "test_account",
      status: "ACTIVE",
      accessTokenEncrypted: encryptToken("test-access-token"),
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });
  return { id: account.id, instagramUserId: account.instagramUserId };
}

/** A Meta-shaped comment webhook payload. */
export function commentWebhook(options: {
  recipientAccountId: string;
  commentId?: string;
  text?: string;
  username?: string;
  postId?: string;
}) {
  return {
    object: "instagram",
    entry: [
      {
        id: options.recipientAccountId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: "comments",
            value: {
              id: options.commentId ?? `c_${Math.random().toString(36).slice(2, 10)}`,
              text: options.text ?? "what is the price?",
              from: { id: "commenter_1", username: options.username ?? "curious_buyer" },
              media: { id: options.postId ?? "post_1" },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Waits for the inline webhook processor to finish.
 *
 * The webhook endpoint answers 200 before processing — that is the whole design
 * — so a test that asserted immediately would race it. Polls the database
 * rather than sleeping a fixed interval, which is both faster and not flaky.
 */
export async function waitForProcessing(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for webhook processing");
}
