import { describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { connectAccount, signUp } from "../../test/helpers.js";

/**
 * Workspace isolation.
 *
 * The requirement is absolute: a user in workspace A must never reach anything
 * belonging to workspace B. These tests attack it directly, using ids the
 * attacker legitimately knows, because that is the realistic case — an id
 * leaked in a screenshot, a URL shared in a support ticket.
 */
describe("workspace isolation", () => {
  async function twoTenants() {
    const alice = await signUp({ workspaceName: "Alice Co" });
    const bob = await signUp({ workspaceName: "Bob Co" });
    await connectAccount(alice.workspaceId);
    await connectAccount(bob.workspaceId);

    const created = await alice.agent
      .post("/api/workflows")
      .set("X-Workspace-Id", alice.workspaceId)
      .send({
        name: "Alice's private workflow",
        triggerType: "COMMENT_RECEIVED",
        conditions: [{ field: "comment.text", operator: "contains", value: "secret" }],
        actions: [{ actionType: "REPLY_TO_COMMENT", configuration: { message: "hi" } }],
      })
      .expect(201);

    return { alice, bob, aliceWorkflowId: created.body.data.workflow.id as string };
  }

  it("hides another workspace's workflow from the list", async () => {
    const { bob } = await twoTenants();

    const response = await bob.agent
      .get("/api/workflows")
      .set("X-Workspace-Id", bob.workspaceId)
      .expect(200);

    expect(response.body.data.workflows).toHaveLength(0);
  });

  it("returns 404 — not 403 — when reading another workspace's workflow by id", async () => {
    const { bob, aliceWorkflowId } = await twoTenants();

    const response = await bob.agent
      .get(`/api/workflows/${aliceWorkflowId}`)
      .set("X-Workspace-Id", bob.workspaceId)
      .expect(404);

    // 403 would confirm the id exists, turning this into an enumeration oracle.
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("refuses to update another workspace's workflow", async () => {
    const { bob, aliceWorkflowId } = await twoTenants();

    await bob.agent
      .patch(`/api/workflows/${aliceWorkflowId}`)
      .set("X-Workspace-Id", bob.workspaceId)
      .send({
        name: "Hijacked",
        triggerType: "COMMENT_RECEIVED",
        conditions: [],
        actions: [{ actionType: "REPLY_TO_COMMENT", configuration: { message: "hijacked" } }],
      })
      .expect(404);

    const untouched = await prisma.workflow.findUnique({ where: { id: aliceWorkflowId } });
    expect(untouched?.name).toBe("Alice's private workflow");
  });

  it("refuses to delete another workspace's workflow", async () => {
    const { bob, aliceWorkflowId } = await twoTenants();

    await bob.agent
      .delete(`/api/workflows/${aliceWorkflowId}`)
      .set("X-Workspace-Id", bob.workspaceId)
      .expect(404);

    expect(await prisma.workflow.count({ where: { id: aliceWorkflowId } })).toBe(1);
  });

  it("ignores a forged X-Workspace-Id and falls back to the caller's own workspace", async () => {
    const { alice, bob } = await twoTenants();

    // Bob claims Alice's workspace. The claim is validated against membership,
    // fails, and falls through — degrading to Bob's own workspace rather than
    // erroring, which is also what makes a stale cookie harmless.
    const response = await bob.agent
      .get("/api/workspaces/current")
      .set("X-Workspace-Id", alice.workspaceId)
      .expect(200);

    expect(response.body.data.workspace.id).toBe(bob.workspaceId);
    expect(response.body.data.workspace.id).not.toBe(alice.workspaceId);
  });

  it("refuses to switch into a workspace the user does not belong to", async () => {
    const { alice, bob } = await twoTenants();

    const response = await bob.agent
      .post("/api/workspaces/switch")
      .send({ workspaceId: alice.workspaceId })
      .expect(404);

    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("scopes the dashboard to the caller's workspace", async () => {
    const { alice, bob } = await twoTenants();

    const bobDashboard = await bob.agent
      .get("/api/dashboard")
      .set("X-Workspace-Id", bob.workspaceId)
      .expect(200);

    expect(bobDashboard.body.data.summary.workflows.total).toBe(0);

    const aliceDashboard = await alice.agent
      .get("/api/dashboard")
      .set("X-Workspace-Id", alice.workspaceId)
      .expect(200);

    expect(aliceDashboard.body.data.summary.workflows.total).toBe(1);
  });

  it("never exposes the encrypted access token", async () => {
    const { alice } = await twoTenants();

    const response = await alice.agent
      .get("/api/instagram")
      .set("X-Workspace-Id", alice.workspaceId)
      .expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("accessTokenEncrypted");
    expect(serialized).not.toContain("test-access-token");
    // The safe fields are present, so this is not passing by returning nothing.
    expect(response.body.data.account.username).toBe("test_account");
  });
});
