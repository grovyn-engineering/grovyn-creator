import type { Prisma, Session, User } from "@prisma/client";
import type { Db } from "../../config/prisma.js";
import { prisma } from "../../config/prisma.js";

/**
 * Data access for identity and sessions. No hashing, no cookie handling, no
 * policy — those live in the service. This layer only knows how rows are
 * shaped and which indexes exist.
 */

/** Columns safe to hand upward. Excludes `passwordHash` by construction. */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

export function findUserByEmail(email: string, db: Db = prisma): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export function findSafeUserById(id: string, db: Db = prisma): Promise<SafeUser | null> {
  return db.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
}

export function createUser(
  data: { email: string; name: string; passwordHash: string },
  db: Db = prisma
): Promise<User> {
  return db.user.create({ data });
}

export function updateUserName(id: string, name: string, db: Db = prisma): Promise<SafeUser> {
  return db.user.update({ where: { id }, data: { name }, select: SAFE_USER_SELECT });
}

export function updateUserPassword(
  id: string,
  passwordHash: string,
  db: Db = prisma
): Promise<User> {
  return db.user.update({ where: { id }, data: { passwordHash } });
}

// ── Sessions ─────────────────────────────────────────────────────────────

export function createSession(
  data: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
    activeWorkspaceId?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
  db: Db = prisma
): Promise<Session> {
  return db.session.create({ data });
}

/**
 * The session lookup on every authenticated request: one indexed read that
 * also brings back the user, so authentication costs a single round trip.
 */
export function findSessionByTokenHash(
  tokenHash: string,
  db: Db = prisma
): Promise<(Session & { user: SafeUser }) | null> {
  return db.session.findUnique({
    where: { tokenHash },
    include: { user: { select: SAFE_USER_SELECT } },
  });
}

export function deleteSessionById(id: string, db: Db = prisma): Promise<unknown> {
  // deleteMany, not delete: logging out twice is a normal thing for a browser
  // to do, and the second call must not throw P2025.
  return db.session.deleteMany({ where: { id } });
}

/** Used after a password change, to invalidate every other device. */
export function deleteSessionsForUser(
  userId: string,
  exceptSessionId: string | null,
  db: Db = prisma
): Promise<unknown> {
  return db.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export function setSessionActiveWorkspace(
  sessionId: string,
  workspaceId: string | null,
  db: Db = prisma
): Promise<unknown> {
  return db.session.updateMany({ where: { id: sessionId }, data: { activeWorkspaceId: workspaceId } });
}

export function touchSession(sessionId: string, db: Db = prisma): Promise<unknown> {
  return db.session.updateMany({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
}

export function deleteExpiredSessions(now: Date, db: Db = prisma): Promise<{ count: number }> {
  return db.session.deleteMany({ where: { expiresAt: { lt: now } } });
}
