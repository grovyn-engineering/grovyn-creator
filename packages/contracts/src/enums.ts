import { z } from "zod";

/**
 * Every enum in the product is declared here once, as a Zod schema with a
 * derived TypeScript type. Prisma has its own copy in schema.prisma; the two
 * are kept in lockstep by `apps/api/src/config/enum-parity.test.ts`, which
 * fails the build if a member is added on one side only.
 */

// ── Workspace ────────────────────────────────────────────────────────────

/**
 * V1 only ever assigns OWNER, but the column and the checks are written
 * against the full ladder so adding collaborators later is a UI change
 * rather than a migration plus an authorization rewrite.
 */
export const workspaceRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** Ordered most- to least-privileged. `hasRole` compares by index. */
export const ROLE_RANK: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

/** True when `actual` is at least as privileged as `required`. */
export function hasRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK.indexOf(actual) <= ROLE_RANK.indexOf(required);
}

// ── Social platform ──────────────────────────────────────────────────────

/**
 * V1 is Instagram-only and deliberately ships a single-member enum. It exists
 * so that platform-qualified rows and provider lookups are already keyed by
 * platform — adding a second platform is then an enum member plus a provider
 * implementation, not a schema migration across every table.
 */
export const socialPlatformSchema = z.enum(["INSTAGRAM"]);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

// ── Instagram account ────────────────────────────────────────────────────

export const instagramAccountStatusSchema = z.enum([
  /** Token present and believed valid. */
  "ACTIVE",
  /** Token past `tokenExpiresAt`, or Meta returned an expiry error. Recoverable by reconnecting. */
  "EXPIRED",
  /** The user revoked access from Meta's side. Recoverable by reconnecting. */
  "REVOKED",
  /** The user disconnected from inside SocialPilot. Terminal until they reconnect. */
  "DISCONNECTED",
]);
export type InstagramAccountStatus = z.infer<typeof instagramAccountStatusSchema>;

/** Statuses in which the account can still perform actions against Meta. */
export const USABLE_ACCOUNT_STATUSES: readonly InstagramAccountStatus[] = ["ACTIVE"];

// ── Workflow ─────────────────────────────────────────────────────────────

export const workflowStatusSchema = z.enum([
  /** Created but never enabled. Never matches an event. */
  "DRAFT",
  /** Enabled. Eligible to match incoming events. */
  "ACTIVE",
  /** Explicitly disabled by the user. Never matches an event. */
  "PAUSED",
]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const workflowTriggerTypeSchema = z.enum([
  "COMMENT_RECEIVED",
  "MESSAGE_RECEIVED",
  "MENTION_RECEIVED",
]);
export type WorkflowTriggerType = z.infer<typeof workflowTriggerTypeSchema>;

// ── Conditions ───────────────────────────────────────────────────────────

/**
 * The set of fields a condition may read. Closed on purpose: a condition can
 * only reference a path the event normalizer guarantees to produce, so the
 * builder can offer a typed picker and the evaluator never dereferences an
 * arbitrary user-supplied path.
 */
export const conditionFieldSchema = z.enum([
  "comment.text",
  "comment.post_id",
  "comment.author_username",
  "message.text",
  "message.sender_username",
  "mention.text",
]);
export type ConditionField = z.infer<typeof conditionFieldSchema>;

export const conditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
]);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

/** Fields each trigger type can actually populate, used to validate on write. */
export const FIELDS_BY_TRIGGER: Record<WorkflowTriggerType, readonly ConditionField[]> = {
  COMMENT_RECEIVED: ["comment.text", "comment.post_id", "comment.author_username"],
  MESSAGE_RECEIVED: ["message.text", "message.sender_username"],
  MENTION_RECEIVED: ["mention.text"],
};

// ── Actions ──────────────────────────────────────────────────────────────

export const workflowActionTypeSchema = z.enum([
  "REPLY_TO_COMMENT",
  "SEND_DIRECT_MESSAGE",
  "LIKE_COMMENT",
]);
export type WorkflowActionType = z.infer<typeof workflowActionTypeSchema>;

/** Actions each trigger type can perform, used to validate on write. */
export const ACTIONS_BY_TRIGGER: Record<WorkflowTriggerType, readonly WorkflowActionType[]> = {
  COMMENT_RECEIVED: ["REPLY_TO_COMMENT", "SEND_DIRECT_MESSAGE", "LIKE_COMMENT"],
  MESSAGE_RECEIVED: ["SEND_DIRECT_MESSAGE"],
  MENTION_RECEIVED: ["SEND_DIRECT_MESSAGE"],
};

// ── Execution ────────────────────────────────────────────────────────────

export const executionStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  /** Trigger matched but conditions evaluated false, or the run was a dry run. */
  "SKIPPED",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** Statuses that will never change again. Used by retention and retry logic. */
export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "SUCCESS",
  "FAILED",
  "SKIPPED",
];

export const executionModeSchema = z.enum([
  /** Actions call the live provider. */
  "LIVE",
  /** Matching and evaluation run for real; actions are recorded but not sent. */
  "DRY_RUN",
]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

// ── Webhook events ───────────────────────────────────────────────────────

export const webhookEventTypeSchema = z.enum([
  "COMMENT",
  "MESSAGE",
  "MENTION",
  /** Received, stored, and acknowledged, but not something V1 acts on. */
  "UNKNOWN",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

/** Maps a normalized inbound event onto the trigger it can fire. */
export const TRIGGER_BY_EVENT_TYPE: Record<
  WebhookEventType,
  WorkflowTriggerType | null
> = {
  COMMENT: "COMMENT_RECEIVED",
  MESSAGE: "MESSAGE_RECEIVED",
  MENTION: "MENTION_RECEIVED",
  UNKNOWN: null,
};

// ── Audit log ────────────────────────────────────────────────────────────

export const auditActionSchema = z.enum([
  "USER_SIGNED_UP",
  "USER_LOGGED_IN",
  "USER_LOGGED_OUT",
  "WORKSPACE_CREATED",
  "WORKSPACE_UPDATED",
  "INSTAGRAM_CONNECTED",
  "INSTAGRAM_DISCONNECTED",
  "WORKFLOW_CREATED",
  "WORKFLOW_UPDATED",
  "WORKFLOW_DELETED",
  "WORKFLOW_ENABLED",
  "WORKFLOW_DISABLED",
  "WORKFLOW_EXECUTED",
  "WORKFLOW_FAILED",
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntityTypeSchema = z.enum([
  "USER",
  "WORKSPACE",
  "INSTAGRAM_ACCOUNT",
  "WORKFLOW",
  "WORKFLOW_EXECUTION",
]);
export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;
