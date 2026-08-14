import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";
import {
  ACTIONS_BY_TRIGGER,
  FIELDS_BY_TRIGGER,
  conditionFieldSchema,
  conditionOperatorSchema,
  executionModeSchema,
  executionStatusSchema,
  workflowActionTypeSchema,
  workflowStatusSchema,
  workflowTriggerTypeSchema,
} from "./enums.js";

// ── Conditions ───────────────────────────────────────────────────────────

/**
 * A single IF clause. Conditions on a workflow are joined with AND — there is
 * no OR and no nesting in V1, which is what keeps the builder readable as a
 * sentence. A user who needs OR creates a second workflow, which is both
 * easier to explain and easier to observe in the execution log.
 */
export const workflowConditionInputSchema = z.object({
  field: conditionFieldSchema,
  operator: conditionOperatorSchema,
  /**
   * Compared case-insensitively after trimming, matching how a person reads
   * "contains price". Bounded so a condition cannot be used to store bulk data.
   */
  value: z.string().trim().min(1, "Enter a value to match.").max(500),
});
export type WorkflowConditionInput = z.infer<typeof workflowConditionInputSchema>;

export const workflowConditionSchema = workflowConditionInputSchema.extend({
  id: idSchema,
  position: z.number().int().min(0),
});
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

// ── Action configuration ─────────────────────────────────────────────────

/**
 * Message bodies support `{{variable}}` interpolation against the normalized
 * event (see workflow-engine.md for the resolvable set). The cap is Meta's
 * practical limit for a comment reply, applied to every text action for
 * consistency.
 */
const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Write the message to send.")
  .max(1000, "Keep the message under 1000 characters.");

export const replyToCommentConfigSchema = z.object({
  message: messageBodySchema,
});

export const sendDirectMessageConfigSchema = z.object({
  message: messageBodySchema,
});

/**
 * A like takes no configuration. It still carries an object rather than null
 * so every action row stores the same JSON shape and the discriminated union
 * stays uniform.
 */
export const likeCommentConfigSchema = z.object({});

/**
 * Configuration is discriminated by the action's own `actionType`, so a row
 * can never carry configuration belonging to a different action. Parsing this
 * union is what turns the untyped `configuration` JSON column back into a
 * type the executor can rely on.
 */
export const workflowActionInputSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("REPLY_TO_COMMENT"),
    configuration: replyToCommentConfigSchema,
  }),
  z.object({
    actionType: z.literal("SEND_DIRECT_MESSAGE"),
    configuration: sendDirectMessageConfigSchema,
  }),
  z.object({
    actionType: z.literal("LIKE_COMMENT"),
    configuration: likeCommentConfigSchema,
  }),
]);
export type WorkflowActionInput = z.infer<typeof workflowActionInputSchema>;

export const workflowActionSchema = z.intersection(
  workflowActionInputSchema,
  z.object({ id: idSchema, position: z.number().int().min(0) })
);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

// ── Workflow ─────────────────────────────────────────────────────────────

export const workflowNameSchema = z
  .string()
  .trim()
  .min(1, "Name this workflow.")
  .max(80, "Workflow names are limited to 80 characters.");

export const workflowSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: workflowStatusSchema,
  triggerType: workflowTriggerTypeSchema,
  conditions: z.array(workflowConditionSchema),
  actions: z.array(workflowActionSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Workflow = z.infer<typeof workflowSchema>;

/** Row shape for the workflows table — no conditions/actions, plus live counters. */
export const workflowSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: workflowStatusSchema,
  triggerType: workflowTriggerTypeSchema,
  conditionCount: z.number().int().min(0),
  actionCount: z.number().int().min(0),
  executionCount: z.number().int().min(0),
  lastExecutedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

/**
 * Cross-field rules that apply to any workflow write. Kept as a standalone
 * refinement so create and update enforce exactly the same invariants — a
 * workflow that could not be created must not be reachable via update.
 */
function refineWorkflowShape(
  value: {
    triggerType: z.infer<typeof workflowTriggerTypeSchema>;
    conditions: WorkflowConditionInput[];
    actions: WorkflowActionInput[];
  },
  ctx: z.RefinementCtx
): void {
  const allowedFields = FIELDS_BY_TRIGGER[value.triggerType];
  value.conditions.forEach((condition, index) => {
    if (!allowedFields.includes(condition.field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions", index, "field"],
        message: `This trigger cannot read ${condition.field}.`,
      });
    }
  });

  const allowedActions = ACTIONS_BY_TRIGGER[value.triggerType];
  value.actions.forEach((action, index) => {
    if (!allowedActions.includes(action.actionType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "actionType"],
        message: `This trigger cannot perform ${action.actionType}.`,
      });
    }
  });
}

const workflowWriteShape = {
  name: workflowNameSchema,
  description: z.string().trim().max(280).nullable().optional(),
  triggerType: workflowTriggerTypeSchema,
  /** Zero conditions is valid and means "every event of this type matches". */
  conditions: z.array(workflowConditionInputSchema).max(10).default([]),
  /**
   * At least one action: a workflow with no actions can never do anything,
   * so accepting one would only produce executions that succeed silently.
   */
  actions: z
    .array(workflowActionInputSchema)
    .min(1, "Add at least one action.")
    .max(5),
};

export const createWorkflowRequestSchema = z
  .object(workflowWriteShape)
  .superRefine(refineWorkflowShape);
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;

/**
 * Update replaces conditions and actions wholesale rather than patching them
 * individually. Positional edits over two ordered child collections are a
 * large surface for partial-write bugs, and the builder always holds the
 * complete list anyway.
 */
export const updateWorkflowRequestSchema = z
  .object(workflowWriteShape)
  .superRefine(refineWorkflowShape);
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;

export const listWorkflowsQuerySchema = z.object({
  status: workflowStatusSchema.optional(),
  search: z.string().trim().max(80).optional(),
});
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

// ── Executions ───────────────────────────────────────────────────────────

/** One action's outcome inside an execution. */
export const executionActionResultSchema = z.object({
  actionId: idSchema,
  actionType: workflowActionTypeSchema,
  status: executionStatusSchema,
  /** Provider-side id of whatever was created (a reply, a message). */
  externalId: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExecutionActionResult = z.infer<typeof executionActionResultSchema>;

export const workflowExecutionSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  workflowName: z.string(),
  workspaceId: idSchema,
  eventId: idSchema.nullable(),
  status: executionStatusSchema,
  mode: executionModeSchema,
  /** Why a matched trigger did not run its actions. Null unless SKIPPED. */
  skipReason: z.string().nullable(),
  /** The normalized event the run saw. Safe to display. */
  input: z.record(z.unknown()).nullable(),
  results: z.array(executionActionResultSchema),
  /** User-safe failure summary. Provider payloads are logged, not returned. */
  error: z.string().nullable(),
  startedAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  /** Milliseconds, null while still running. */
  durationMs: z.number().int().nullable(),
});
export type WorkflowExecution = z.infer<typeof workflowExecutionSchema>;

export const listExecutionsQuerySchema = z.object({
  status: executionStatusSchema.optional(),
  workflowId: idSchema.optional(),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

/**
 * Body for `POST /api/workflows/:id/test`. Lets a user run their workflow
 * against a sample event without waiting for a real one — the same engine
 * path, in DRY_RUN mode, so what they see is what will happen.
 */
export const testWorkflowRequestSchema = z.object({
  sample: z.object({
    text: z.string().max(1000).default(""),
    authorUsername: z.string().trim().max(80).default("test_user"),
    postId: z.string().trim().max(120).default("sample_post"),
  }),
});
export type TestWorkflowRequest = z.infer<typeof testWorkflowRequestSchema>;
