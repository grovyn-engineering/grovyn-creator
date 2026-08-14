import { z } from "zod";
import {
  ACTIONS_BY_TRIGGER,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  FIELDS_BY_TRIGGER,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_TRIGGER_TYPES,
  type ExecutionMode,
  type ExecutionStatus,
  type WorkflowActionType,
  type WorkflowStatus,
  type WorkflowTriggerType,
} from "./enums";

/** Mirrors `backend/src/contracts/workflow.ts`. */

export const conditionFieldSchema = z.enum(CONDITION_FIELDS);
export const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export const workflowActionTypeSchema = z.enum(WORKFLOW_ACTION_TYPES);
export const workflowTriggerTypeSchema = z.enum(WORKFLOW_TRIGGER_TYPES);

export const workflowConditionInputSchema = z.object({
  field: conditionFieldSchema,
  operator: conditionOperatorSchema,
  value: z.string().trim().min(1, "Enter a value to match.").max(500),
});
export type WorkflowConditionInput = z.infer<typeof workflowConditionInputSchema>;

export interface WorkflowCondition extends WorkflowConditionInput {
  id: string;
  position: number;
}

const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Write the message to send.")
  .max(1000, "Keep the message under 1000 characters.");

export const replyToCommentConfigSchema = z.object({ message: messageBodySchema });
export const sendDirectMessageConfigSchema = z.object({ message: messageBodySchema });
/** A like takes no configuration, but still carries an object so the union stays uniform. */
export const likeCommentConfigSchema = z.object({});

/**
 * Configuration is discriminated by the action's own `actionType`, so a row can
 * never carry configuration belonging to a different action.
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

export type WorkflowAction = WorkflowActionInput & { id: string; position: number };

export const workflowNameSchema = z
  .string()
  .trim()
  .min(1, "Name this workflow.")
  .max(80, "Workflow names are limited to 80 characters.");

/**
 * Cross-field rules, shared by create and update so a workflow that could not
 * be created is not reachable via update.
 */
function refineWorkflowShape(
  value: {
    triggerType: WorkflowTriggerType;
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
  /** At least one: a workflow with no actions can never do anything. */
  actions: z.array(workflowActionInputSchema).min(1, "Add at least one action.").max(5),
};

export const createWorkflowRequestSchema = z
  .object(workflowWriteShape)
  .superRefine(refineWorkflowShape);
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;

export const updateWorkflowRequestSchema = z
  .object(workflowWriteShape)
  .superRefine(refineWorkflowShape);
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  triggerType: WorkflowTriggerType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  createdAt: string;
  updatedAt: string;
}

/** Row shape for the workflows table — no children, plus live counters. */
export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  triggerType: WorkflowTriggerType;
  conditionCount: number;
  actionCount: number;
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionActionResult {
  actionId: string;
  actionType: WorkflowActionType;
  status: ExecutionStatus;
  externalId: string | null;
  error: string | null;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  eventId: string | null;
  status: ExecutionStatus;
  mode: ExecutionMode;
  /** Why a matched trigger did not act. Populated only for SKIPPED. */
  skipReason: string | null;
  input: Record<string, unknown> | null;
  results: ExecutionActionResult[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface TestWorkflowRequest {
  sample: {
    text: string;
    authorUsername: string;
    postId: string;
  };
}
