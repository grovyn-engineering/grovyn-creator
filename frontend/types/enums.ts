/**
 * Enums the UI branches on. Mirrors `backend/src/contracts/enums.ts`.
 *
 * `backend/src/config/contract-drift.test.ts` compares every list below against
 * the backend's and fails the build on a mismatch — so a member added on one
 * side only is caught in CI rather than surfacing as a value the API returns
 * and the UI cannot render.
 */

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const INSTAGRAM_ACCOUNT_STATUSES = [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "DISCONNECTED",
] as const;
export type InstagramAccountStatus = (typeof INSTAGRAM_ACCOUNT_STATUSES)[number];

export const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_TRIGGER_TYPES = [
  "COMMENT_RECEIVED",
  "MESSAGE_RECEIVED",
  "MENTION_RECEIVED",
] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const CONDITION_FIELDS = [
  "comment.text",
  "comment.post_id",
  "comment.author_username",
  "message.text",
  "message.sender_username",
  "mention.text",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const WORKFLOW_ACTION_TYPES = [
  "REPLY_TO_COMMENT",
  "SEND_DIRECT_MESSAGE",
  "LIKE_COMMENT",
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export const EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_MODES = ["LIVE", "DRY_RUN"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const WEBHOOK_EVENT_TYPES = ["COMMENT", "MESSAGE", "MENTION", "UNKNOWN"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Which fields each trigger can read, and which actions it can perform.
 *
 * Duplicated from the backend because the builder needs them to populate its
 * pickers and to prune choices when the trigger changes. The backend enforces
 * the same tables on write, so a stale copy here produces a server-side
 * validation error rather than an invalid workflow.
 */
export const FIELDS_BY_TRIGGER: Record<WorkflowTriggerType, readonly ConditionField[]> = {
  COMMENT_RECEIVED: ["comment.text", "comment.post_id", "comment.author_username"],
  MESSAGE_RECEIVED: ["message.text", "message.sender_username"],
  MENTION_RECEIVED: ["mention.text"],
};

export const ACTIONS_BY_TRIGGER: Record<WorkflowTriggerType, readonly WorkflowActionType[]> = {
  COMMENT_RECEIVED: ["REPLY_TO_COMMENT", "SEND_DIRECT_MESSAGE", "LIKE_COMMENT"],
  MESSAGE_RECEIVED: ["SEND_DIRECT_MESSAGE"],
  MENTION_RECEIVED: ["SEND_DIRECT_MESSAGE"],
};
