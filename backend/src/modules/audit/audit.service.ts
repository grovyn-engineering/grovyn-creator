import type { Prisma } from "@prisma/client";
import type { AuditAction, AuditEntityType } from "../../contracts/index.js";
import type { Db } from "../../config/prisma.js";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";

/**
 * Append-only audit trail.
 *
 * Two decisions worth stating:
 *
 * Writes never throw into the caller. An audit failure must not roll back the
 * action it describes — refusing to connect an Instagram account because the
 * log insert failed would be a worse outcome than an incomplete log. Failures
 * are logged at error level instead, which is what surfaces them.
 *
 * Metadata is redacted on the way in. The column is Json and therefore accepts
 * anything, so the boundary is enforced here rather than trusted at each call
 * site — a token reaching this table would be a reportable defect.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "passwordhash",
  "accesstoken",
  "access_token",
  "accesstokenencrypted",
  "refreshtoken",
  "refresh_token",
  "token",
  "code",
  "state",
  "secret",
  "appsecret",
  "authorization",
  "cookie",
]);

/** Depth cap: metadata is context, and a deeply nested blob is a sign of misuse. */
const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  /** Null for account-level events that precede any workspace, such as signup. */
  workspaceId?: string | null;
  /** Null when the actor is the system — an engine run has no human behind it. */
  userId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function record(entry: AuditEntry, db: Db = prisma): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        workspaceId: entry.workspaceId ?? null,
        userId: entry.userId ?? null,
        metadata: entry.metadata
          ? (redact(entry.metadata) as Prisma.InputJsonValue)
          : undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}

/**
 * Records inside an existing transaction. Used where the audit row genuinely
 * must share the fate of the write — workspace creation, for instance, where a
 * committed workspace with no creation record would be a gap in the trail with
 * no way to notice it. Unlike `record`, this one propagates.
 */
export async function recordInTransaction(entry: AuditEntry, tx: Db): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      workspaceId: entry.workspaceId ?? null,
      userId: entry.userId ?? null,
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
