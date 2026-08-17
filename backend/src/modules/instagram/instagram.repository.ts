import type { Prisma } from "@prisma/client";
import type { Db } from "../../config/prisma.js";
import { prisma } from "../../config/prisma.js";

/**
 * Data access for connected accounts.
 *
 * `SAFE_ACCOUNT_SELECT` is the enforcement point for the rule that the
 * encrypted token never reaches a response. Every read that feeds an API
 * response goes through it; the two places that genuinely need the ciphertext
 * name it explicitly, so a `select *` can never quietly leak it — this is the
 * direct answer to the defect found in the audited system, where a dashboard
 * query shipped a channel's webhook secret to the browser.
 */
export const SAFE_ACCOUNT_SELECT = {
  id: true,
  workspaceId: true,
  instagramUserId: true,
  username: true,
  displayName: true,
  profilePictureUrl: true,
  status: true,
  tokenExpiresAt: true,
  connectedAt: true,
  updatedAt: true,
} satisfies Prisma.InstagramAccountSelect;

export type SafeInstagramAccount = Prisma.InstagramAccountGetPayload<{
  select: typeof SAFE_ACCOUNT_SELECT;
}>;

export function findAccountForWorkspace(
  workspaceId: string,
  db: Db = prisma
): Promise<SafeInstagramAccount | null> {
  // V1 connects one account per workspace. `findFirst` rather than a unique
  // lookup so allowing several later is a service change, not a schema one.
  return db.instagramAccount.findFirst({
    where: { workspaceId },
    select: SAFE_ACCOUNT_SELECT,
    orderBy: { connectedAt: "desc" },
  });
}

export function findAccountById(
  id: string,
  workspaceId: string,
  db: Db = prisma
): Promise<SafeInstagramAccount | null> {
  // workspaceId is part of the predicate, not checked afterwards: an id from
  // another tenant returns null rather than a row the caller must remember to
  // reject.
  return db.instagramAccount.findFirst({
    where: { id, workspaceId },
    select: SAFE_ACCOUNT_SELECT,
  });
}

/**
 * Webhook routing: Instagram's account id → the workspace that owns it.
 * Globally unique by schema, which is what makes an inbound event have exactly
 * one owner.
 */
export function findAccountByInstagramUserId(
  instagramUserId: string,
  db: Db = prisma
): Promise<{ id: string; workspaceId: string; status: string; username: string } | null> {
  return db.instagramAccount.findUnique({
    where: { instagramUserId },
    select: { id: true, workspaceId: true, status: true, username: true },
  });
}

/**
 * Connect, or reconnect.
 *
 * Upsert on `instagramUserId` so reconnecting the same account refreshes the
 * existing row rather than accumulating duplicates — and so the workflows and
 * execution history already attached to that account survive a reconnect.
 */
export function upsertAccount(
  input: {
    workspaceId: string;
    instagramUserId: string;
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
    accessTokenEncrypted: string;
    tokenExpiresAt: Date | null;
  },
  db: Db = prisma
) {
  const shared = {
    username: input.username,
    displayName: input.displayName,
    profilePictureUrl: input.profilePictureUrl,
    accessTokenEncrypted: input.accessTokenEncrypted,
    tokenExpiresAt: input.tokenExpiresAt,
    tokenRefreshedAt: new Date(),
    status: "ACTIVE" as const,
  };

  return db.instagramAccount.upsert({
    where: { instagramUserId: input.instagramUserId },
    create: {
      workspaceId: input.workspaceId,
      instagramUserId: input.instagramUserId,
      connectedAt: new Date(),
      ...shared,
    },
    update: { workspaceId: input.workspaceId, connectedAt: new Date(), ...shared },
    select: SAFE_ACCOUNT_SELECT,
  });
}

/**
 * Disconnect marks the row rather than deleting it.
 *
 * Deleting would cascade nothing directly, but it would orphan the execution
 * history's meaning — "which account did this run against?" becomes
 * unanswerable. The token is overwritten with a tombstone so the credential is
 * genuinely gone even though the record stays.
 */
export function disconnectAccount(id: string, db: Db = prisma) {
  return db.instagramAccount.update({
    where: { id },
    data: { status: "DISCONNECTED", accessTokenEncrypted: "", tokenExpiresAt: null },
    select: SAFE_ACCOUNT_SELECT,
  });
}

export function countActiveAccounts(workspaceId: string, db: Db = prisma): Promise<number> {
  return db.instagramAccount.count({ where: { workspaceId, status: "ACTIVE" } });
}

// ── OAuth state ──────────────────────────────────────────────────────────

export function createOAuthState(
  input: { state: string; workspaceId: string; userId: string; returnTo: string | null; expiresAt: Date },
  db: Db = prisma
) {
  return db.oAuthState.create({ data: input });
}

/**
 * Consumes a state exactly once.
 *
 * `updateMany` with `consumedAt: null` in the predicate makes the check and the
 * claim a single atomic statement: two concurrent callbacks carrying the same
 * state cannot both see it unconsumed, because only one update matches a row.
 * A read-then-write would let both through.
 */
export async function consumeOAuthState(state: string, db: Db = prisma) {
  const claimed = await db.oAuthState.updateMany({
    where: { state, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  if (claimed.count === 0) return null;

  return db.oAuthState.findUnique({ where: { state } });
}

export function deleteExpiredOAuthStates(db: Db = prisma) {
  return db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
