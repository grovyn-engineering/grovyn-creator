import type { ExecutionMode, NormalizedEvent } from "@socialpilot/contracts";
import { TRIGGER_BY_EVENT_TYPE } from "@socialpilot/contracts";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import * as audit from "../modules/audit/audit.service.js";
import { executeAction, type ActionContext } from "./actions.js";
import { evaluateConditions } from "./conditions.js";
import { buildVariables } from "./variables.js";

/**
 * The workflow engine.
 *
 * Deliberately free of React, Express, and Meta: it takes a normalized event
 * plus a workspace, and writes execution rows. Its only I/O is Prisma and the
 * action executors, and the executors go through the provider interface. That
 * is what makes the engine testable with a plain object and a mock provider.
 *
 * The flat trigger → conditions → actions model is a considered choice over the
 * node-graph engine in the audited system. V1's use cases are all expressible
 * as a sentence — "when a comment arrives, if it contains 'price', reply and
 * DM" — and a linear model means the builder can render that sentence
 * literally, the execution record is a flat list, and there is no traversal
 * state to reason about.
 */

export interface EngineResult {
  /** Workflows whose trigger matched the event, before conditions were applied. */
  candidates: number;
  executed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  executionIds: string[];
}

export interface RunOptions {
  mode?: ExecutionMode;
  /** Links executions to the stored event. Null for a manual test run. */
  webhookEventId?: string | null;
}

export async function runEvent(
  input: { workspaceId: string; instagramAccountId: string; event: NormalizedEvent },
  options: RunOptions = {}
): Promise<EngineResult> {
  const { workspaceId, event } = input;
  const mode = options.mode ?? "LIVE";
  const webhookEventId = options.webhookEventId ?? null;

  const result: EngineResult = {
    candidates: 0,
    executed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    executionIds: [],
  };

  const triggerType = TRIGGER_BY_EVENT_TYPE[event.eventType];
  if (!triggerType) return result;

  // The hot query, covered by the (workspaceId, status, triggerType) index.
  // `workspaceId` is a required argument all the way down — a workflow lookup
  // that is not tenant-scoped is not reachable from here.
  const workflows = await prisma.workflow.findMany({
    where: { workspaceId, status: "ACTIVE", triggerType },
    include: {
      conditions: { orderBy: { position: "asc" } },
      actions: { orderBy: { position: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  result.candidates = workflows.length;
  if (workflows.length === 0) return result;

  const variables = buildVariables(event);

  for (const workflow of workflows) {
    const evaluation = evaluateConditions(workflow.conditions, variables);

    // A non-matching workflow still gets an execution row, with SKIPPED and the
    // reason. Recording only the runs that fired would leave a user asking "why
    // didn't my workflow do anything?" with nothing to look at — which is the
    // single most common support question this kind of product generates.
    const execution = await createExecution({
      workflowId: workflow.id,
      workspaceId,
      webhookEventId,
      mode,
      event,
      status: evaluation.matched ? "RUNNING" : "SKIPPED",
      skipReason: evaluation.reason,
    });

    // Null means the unique (workflowId, webhookEventId) constraint rejected
    // the insert: this event already ran this workflow. That is idempotency
    // working, not an error.
    if (!execution) {
      logger.debug(
        { workflowId: workflow.id, eventId: event.eventId },
        "execution already exists for this event; skipping"
      );
      continue;
    }

    result.executionIds.push(execution.id);

    if (!evaluation.matched) {
      result.skipped += 1;
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { completedAt: new Date() },
      });
      continue;
    }

    result.executed += 1;
    await runActions({
      executionId: execution.id,
      workspaceId,
      instagramAccountId: input.instagramAccountId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      actions: workflow.actions,
      variables,
      event,
      mode,
      result,
    });
  }

  return result;
}

async function createExecution(input: {
  workflowId: string;
  workspaceId: string;
  webhookEventId: string | null;
  mode: ExecutionMode;
  event: NormalizedEvent;
  status: "RUNNING" | "SKIPPED";
  skipReason: string | null;
}) {
  try {
    return await prisma.workflowExecution.create({
      data: {
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
        webhookEventId: input.webhookEventId,
        mode: input.mode,
        status: input.status,
        skipReason: input.skipReason,
        inputData: input.event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

async function runActions(input: {
  executionId: string;
  workspaceId: string;
  instagramAccountId: string;
  workflowId: string;
  workflowName: string;
  actions: Array<{ id: string; actionType: string; configuration: unknown; position: number }>;
  variables: Record<string, string>;
  event: NormalizedEvent;
  mode: ExecutionMode;
  result: EngineResult;
}): Promise<void> {
  const context: ActionContext = {
    workspaceId: input.workspaceId,
    instagramAccountId: input.instagramAccountId,
    variables: input.variables,
    event: input.event,
    mode: input.mode,
  };

  let anyFailed = false;
  let firstError: string | null = null;

  for (const action of input.actions) {
    const row = await prisma.workflowExecutionAction.create({
      data: {
        executionId: input.executionId,
        actionId: action.id,
        actionType: action.actionType as never,
        position: action.position,
        status: "RUNNING",
      },
    });

    try {
      const outcome = await executeAction(
        { actionType: action.actionType, configuration: action.configuration },
        context
      );

      await prisma.workflowExecutionAction.update({
        where: { id: row.id },
        data: {
          status: outcome.skipped ? "SKIPPED" : "SUCCESS",
          externalId: outcome.externalId ?? null,
          error: outcome.skipReason ?? null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      anyFailed = true;
      const message = toUserMessage(error);
      firstError ??= message;

      await prisma.workflowExecutionAction.update({
        where: { id: row.id },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });

      logger.error(
        { err: error, workflowId: input.workflowId, actionType: action.actionType },
        "workflow action failed"
      );

      // Later actions still run. "Reply publicly, then DM" should still send
      // the DM when the public reply fails — stopping would turn one provider
      // hiccup into a total loss, and each action's outcome is recorded
      // separately so nothing is hidden.
    }
  }

  await prisma.workflowExecution.update({
    where: { id: input.executionId },
    data: {
      status: anyFailed ? "FAILED" : "SUCCESS",
      error: firstError,
      completedAt: new Date(),
    },
  });

  if (anyFailed) {
    input.result.failed += 1;
  } else {
    input.result.succeeded += 1;
  }

  void audit.record({
    action: anyFailed ? "WORKFLOW_FAILED" : "WORKFLOW_EXECUTED",
    entityType: "WORKFLOW_EXECUTION",
    entityId: input.executionId,
    workspaceId: input.workspaceId,
    // No userId: a webhook-driven run has no human behind it.
    userId: null,
    metadata: { workflowId: input.workflowId, workflowName: input.workflowName },
  });
}

/**
 * Provider errors carry Meta's own wording, which names internal fields and
 * object ids. `MetaApiError.toAppError()` already produces a user-safe
 * sentence; anything else collapses to a generic one and is logged in full.
 */
function toUserMessage(error: unknown): string {
  if (error && typeof error === "object" && "toAppError" in error) {
    const appError = (error as { toAppError: () => { message: string } }).toAppError();
    return appError.message;
  }
  if (error instanceof Error && error.name === "AppError") return error.message;
  return "This step could not be completed.";
}
