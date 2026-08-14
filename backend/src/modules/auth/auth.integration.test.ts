import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../config/prisma.js";
import { signUp, testApp } from "../../test/helpers.js";

describe("authentication", () => {
  it("creates a user, workspace, membership and session in one transaction", async () => {
    const { userId, workspaceId } = await signUp({ workspaceName: "Acme Studio" });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: true },
    });

    // The whole point of doing this transactionally: a committed user with no
    // workspace has nowhere to land, and the prior system papered over that by
    // creating one during a page render behind an admin credential.
    expect(workspace?.name).toBe("Acme Studio");
    expect(workspace?.ownerId).toBe(userId);
    expect(workspace?.members).toHaveLength(1);
    expect(workspace?.members[0]?.role).toBe("OWNER");

    expect(await prisma.session.count({ where: { userId } })).toBe(1);
  });

  it("never stores or returns the password", async () => {
    const { userId } = await signUp({ password: "correct-horse-battery" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toContain("correct-horse-battery");
    // Argon2id, identified by its own prefix.
    expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("stores the session as a hash, not the cookie value", async () => {
    const { agent, userId } = await signUp();

    const response = await agent.get("/api/auth/me").expect(200);
    expect(response.body.data.user.id).toBe(userId);

    const session = await prisma.session.findFirst({ where: { userId } });
    expect(session?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a duplicate email", async () => {
    const { email } = await signUp();

    const response = await request(testApp())
      .post("/api/auth/signup")
      .send({ name: "Someone Else", email, password: "another-password" })
      .expect(409);

    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await signUp({ password: "the-real-password" });

    const wrongPassword = await request(testApp())
      .post("/api/auth/login")
      .send({ email, password: "not-the-password" })
      .expect(401);

    const unknownEmail = await request(testApp())
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: "anything" })
      .expect(401);

    // Distinguishing these would turn login into an account-existence oracle,
    // which is the first thing credential-stuffing operators enumerate.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
  });

  it("answers /me with user: null when signed out, not 401", async () => {
    const response = await request(testApp()).get("/api/auth/me").expect(200);
    expect(response.body.data.user).toBeNull();
  });

  it("ends the session on logout", async () => {
    const { agent, userId } = await signUp();

    await agent.post("/api/auth/logout").expect(204);

    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    const after = await agent.get("/api/auth/me").expect(200);
    expect(after.body.data.user).toBeNull();
  });

  it("succeeds at logout even with no session", async () => {
    // The caller's intent is "end my session"; a 401 would leave the browser
    // holding a dead cookie.
    await request(testApp()).post("/api/auth/logout").expect(204);
  });

  it("revokes every other session when the password changes", async () => {
    const { agent, userId, email } = await signUp({ password: "original-password" });

    // A second device.
    await request(testApp())
      .post("/api/auth/login")
      .send({ email, password: "original-password" })
      .expect(200);

    expect(await prisma.session.count({ where: { userId } })).toBe(2);

    await agent
      .post("/api/auth/password")
      .send({ currentPassword: "original-password", newPassword: "a-new-password" })
      .expect(204);

    // A password change is what someone does when they believe another party
    // has access. Leaving that other session alive would defeat the point.
    expect(await prisma.session.count({ where: { userId } })).toBe(1);
    await agent.get("/api/auth/me").expect(200);
  });

  it("rejects a password change with the wrong current password", async () => {
    const { agent } = await signUp({ password: "original-password" });

    const response = await agent
      .post("/api/auth/password")
      .send({ currentPassword: "wrong", newPassword: "a-new-password" })
      .expect(400);

    expect(response.body.error.fields?.[0]?.path).toBe("currentPassword");
  });

  it("rejects protected routes without a session", async () => {
    const response = await request(testApp()).get("/api/workflows").expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns field errors that map to form inputs", async () => {
    const response = await request(testApp())
      .post("/api/auth/signup")
      .send({ name: "", email: "not-an-email", password: "short" })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    const paths = response.body.error.fields.map((f: { path: string }) => f.path);
    expect(paths).toContain("email");
    expect(paths).toContain("password");
  });
});
