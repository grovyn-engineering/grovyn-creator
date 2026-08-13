import { hash, verify } from "@node-rs/argon2";
import type { SessionUser } from "@socialpilot/contracts";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../http/errors.js";
import { generateSessionToken, hashSessionToken } from "../../utils/crypto.js";
import * as audit from "../audit/audit.service.js";
import * as workspaceRepo from "../workspaces/workspaces.repository.js";
import * as repo from "./auth.repository.js";
import { sessionExpiry } from "./session.cookie.js";

/**
 * Argon2id parameters.
 *
 * Argon2id rather than bcrypt: it is memory-hard, so an attacker with GPUs
 * gains far less than they do against bcrypt's small working set. The values
 * below are OWASP's current baseline — 19 MiB, two iterations, one lane — and
 * are stated explicitly instead of relying on library defaults, because a
 * dependency changing its defaults must not silently change the cost of every
 * hash the product has ever written.
 */
const ARGON2_OPTIONS = {
  // 2 = Argon2id in @node-rs/argon2's Algorithm enum.
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Parameters<typeof hash>[1];

/**
 * A pre-computed hash of a value nobody knows, verified against when the email
 * does not exist.
 *
 * Without it, a missing account returns in microseconds while a real one takes
 * ~50 ms of Argon2 work, and that difference is a reliable oracle for which
 * emails are registered. Doing the same work in both branches removes it.
 */
let decoyHash: string | null = null;
async function decoy(): Promise<string> {
  if (!decoyHash) {
    decoyHash = await hash(generateSessionToken(), ARGON2_OPTIONS);
  }
  return decoyHash;
}

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthResult {
  user: SessionUser;
  /** Raw token — goes into the cookie and is never stored or logged. */
  token: string;
  activeWorkspaceId: string;
}

/**
 * Signup provisions the user, their first workspace, and the owner membership
 * in one transaction.
 *
 * Doing it here rather than lazily on first render is deliberate: the audit of
 * the prior system found workspace auto-creation happening inside a page
 * render, behind an admin credential that bypassed row-level security, on a
 * path that also had to handle the failure by redirecting to login. Creating
 * it at signup means every later read can assume a workspace exists and no
 * read path ever writes.
 */
export async function signup(
  input: { name: string; email: string; password: string; workspaceName?: string },
  meta: RequestMeta = {}
): Promise<AuthResult> {
  const passwordHash = await hash(input.password, ARGON2_OPTIONS);
  const token = generateSessionToken();

  const existing = await repo.findUserByEmail(input.email);
  if (existing) {
    // Signup genuinely has to reveal that an email is taken — the alternative
    // is a dead end for the legitimate owner. Login, where the disclosure is
    // gratuitous, does not.
    throw AppError.conflict("An account with that email already exists.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await repo.createUser(
      { email: input.email, name: input.name, passwordHash },
      tx
    );

    const workspace = await workspaceRepo.createWorkspaceWithOwner(
      { name: input.workspaceName?.trim() || defaultWorkspaceName(input.name), ownerId: user.id },
      tx
    );

    const session = await repo.createSession(
      {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt: sessionExpiry(),
        activeWorkspaceId: workspace.id,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
      tx
    );

    await audit.recordInTransaction(
      {
        action: "USER_SIGNED_UP",
        entityType: "USER",
        entityId: user.id,
        userId: user.id,
        ipAddress: meta.ipAddress ?? null,
      },
      tx
    );

    await audit.recordInTransaction(
      {
        action: "WORKSPACE_CREATED",
        entityType: "WORKSPACE",
        entityId: workspace.id,
        workspaceId: workspace.id,
        userId: user.id,
        metadata: { name: workspace.name },
        ipAddress: meta.ipAddress ?? null,
      },
      tx
    );

    return { user, workspace, session };
  });

  logger.info({ userId: result.user.id, workspaceId: result.workspace.id }, "user signed up");

  return {
    user: toSessionUser(result.user),
    token,
    activeWorkspaceId: result.workspace.id,
  };
}

function defaultWorkspaceName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name.trim();
  return `${first}'s workspace`;
}

export async function login(
  input: { email: string; password: string },
  meta: RequestMeta = {}
): Promise<AuthResult> {
  const user = await repo.findUserByEmail(input.email);

  // Argon2 runs in both branches — see `decoy` above. The result of the decoy
  // verification is discarded; only the time it takes matters.
  let valid: boolean;
  if (user) {
    valid = await verifyPassword(user.passwordHash, input.password);
  } else {
    await verifyPassword(await decoy(), input.password);
    valid = false;
  }

  if (!user || !valid) {
    // One message for "no such account" and "wrong password". Distinguishing
    // them would turn this endpoint into an account-existence oracle, which is
    // exactly what credential-stuffing operators enumerate first.
    throw AppError.unauthenticated("That email or password is not correct.");
  }

  const membership = await workspaceRepo.findFirstMembership(user.id);
  const token = generateSessionToken();

  const session = await repo.createSession({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt: sessionExpiry(),
    activeWorkspaceId: membership?.workspaceId ?? null,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  void audit.record({
    action: "USER_LOGGED_IN",
    entityType: "USER",
    entityId: user.id,
    userId: user.id,
    workspaceId: membership?.workspaceId ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  logger.info({ userId: user.id, sessionId: session.id }, "user logged in");

  if (!membership) {
    // Only reachable if a workspace was deleted out from under the user.
    // Repaired here rather than left for a read path to discover.
    const workspace = await workspaceRepo.createWorkspaceWithOwner({
      name: defaultWorkspaceName(user.name),
      ownerId: user.id,
    });
    await repo.setSessionActiveWorkspace(session.id, workspace.id);
    return { user: toSessionUser(user), token, activeWorkspaceId: workspace.id };
  }

  return { user: toSessionUser(user), token, activeWorkspaceId: membership.workspaceId };
}

async function verifyPassword(storedHash: string, candidate: string): Promise<boolean> {
  try {
    return await verify(storedHash, candidate, ARGON2_OPTIONS);
  } catch (error) {
    // A malformed stored hash. Logged because it means a corrupted row, and
    // answered as "wrong password" because it is not the user's problem.
    logger.error({ err: error }, "password verification threw");
    return false;
  }
}

export async function logout(sessionId: string, userId: string, meta: RequestMeta = {}): Promise<void> {
  await repo.deleteSessionById(sessionId);
  void audit.record({
    action: "USER_LOGGED_OUT",
    entityType: "USER",
    entityId: userId,
    userId,
    ipAddress: meta.ipAddress ?? null,
  });
}

/**
 * Resolves a raw cookie value to a live session.
 *
 * Returns null rather than throwing for every rejection — an expired cookie is
 * an ordinary condition, not an exception, and the caller turns it into a 401
 * exactly once.
 */
export async function resolveSession(rawToken: string): Promise<{
  sessionId: string;
  user: SessionUser;
  activeWorkspaceId: string | null;
} | null> {
  const session = await repo.findSessionByTokenHash(hashSessionToken(rawToken));
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Delete on sight, so an abandoned tab stops presenting a dead session and
    // the table does not rely solely on the sweep job.
    await repo.deleteSessionById(session.id);
    return null;
  }

  // Throttled so a busy session is not one write per request.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    void repo.touchSession(session.id);
  }

  return {
    sessionId: session.id,
    user: toSessionUser(session.user),
    activeWorkspaceId: session.activeWorkspaceId,
  };
}

export async function updateProfile(userId: string, name: string): Promise<SessionUser> {
  const user = await repo.updateUserName(userId, name);
  return toSessionUser(user);
}

/**
 * Changing a password revokes every other session. A password change is the
 * action a user takes when they believe someone else has access; leaving that
 * other session alive would defeat the point.
 */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: { currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.unauthenticated();

  const valid = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!valid) {
    throw AppError.validation("Some fields need attention.", [
      { path: "currentPassword", message: "That password is not correct." },
    ]);
  }

  const passwordHash = await hash(input.newPassword, ARGON2_OPTIONS);
  await repo.updateUserPassword(userId, passwordHash);
  await repo.deleteSessionsForUser(userId, currentSessionId);

  logger.info({ userId }, "password changed; other sessions revoked");
}

export async function getProfile(userId: string): Promise<SessionUser> {
  const user = await repo.findSafeUserById(userId);
  if (!user) throw AppError.unauthenticated();
  return toSessionUser(user);
}
