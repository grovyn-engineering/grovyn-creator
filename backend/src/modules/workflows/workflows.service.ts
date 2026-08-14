import type {
  CreateWorkflowRequest,
  ListWorkflowsQuery,
  TestWorkflowRequest,
  UpdateWorkflowRequest,
  Workflow,
  WorkflowSummary,
} from "../../contracts/index.js";
import { normalizedEventSchema, workflowActionInputSchema } from "../../contracts/index.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../http/errors.js";
import { runEvent } from "../../engine/engine.js";
import * as audit from "../audit/audit.service.js";
import * as instagramRepo from "../instagram/instagram.repository.js";
import * as repo from "./workflows.repository.js";
import type { WorkflowWithChildren } from "./workflows.repository.js";

function toDto(workflow: WorkflowWithChildren): Workflow {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    triggerType: workflow.triggerType,
    conditions: workflow.conditions.map((condition) => ({
      id: condition.id,
      field: condition.field as never,
      operator: condition.operator,
      value: condition.value,
      position: condition.position,
    })),
    actions: workflow.actions.map((action) => {
      // Parsed back through the discriminated union rather than cast. The
      // column is Json and could hold anything an older release wrote; a cast
      // would let a stale shape reach the builder and crash it.
      const parsed = workflowActionInputSchema.parse({
        actionType: action.actionType,
        configuration: action.configuration,
      });
      return { ...parsed, id: action.id, position: action.position };
    }),
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

export async function list(
  workspaceId: string,
  query: ListWorkflowsQuery
): Promise<WorkflowSummary[]> {
  const rows = await repo.list(workspaceId, query);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    triggerType: row.triggerType,
    conditionCount: row._count.conditions,
    actionCount: row._count.actions,
    executionCount: row._count.executions,
    lastExecutedAt: row.executions[0]?.startedAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function get(workspaceId: string, id: string): Promise<Workflow> {
  const workflow = await repo.findById(workspaceId, id);
  if (!workflow) throw AppError.notFound("That workflow");
  return toDto(workflow);
}

export async function create(
  workspaceId: string,
  userId: string,
  input: CreateWorkflowRequest
): Promise<Workflow> {
  const workflow = await prisma.$transaction(async (tx) => {
    const created = await repo.create(workspaceId, input, tx);
    await audit.recordInTransaction(
      {
        action: "WORKFLOW_CREATED",
        entityType: "WORKFLOW",
        entityId: created.id,
        workspaceId,
        userId,
        metadata: { name: created.name, triggerType: created.triggerType },
      },
      tx
    );
    return created;
  });

  return toDto(workflow);
}

export async function update(
  workspaceId: string,
  userId: string,
  id: string,
  input: UpdateWorkflowRequest
): Promise<Workflow> {
  const existing = await repo.findById(workspaceId, id);
  if (!existing) throw AppError.notFound("That workflow");

  const workflow = await prisma.$transaction(async (tx) => {
    const replaced = await repo.replace(workspaceId, id, input, tx);
    await audit.recordInTransaction(
      {
        action: "WORKFLOW_UPDATED",
        entityType: "WORKFLOW",
        entityId: id,
        workspaceId,
        userId,
        metadata: { name: replaced.name },
      },
      tx
    );
    return replaced;
  });

  return toDto(workflow);
}

export async function remove(workspaceId: string, userId: string, id: string): Promise<void> {
  const deleted = await repo.remove(workspaceId, id);
  if (deleted.count === 0) throw AppError.notFound("That workflow");

  void audit.record({
    action: "WORKFLOW_DELETED",
    entityType: "WORKFLOW",
    entityId: id,
    workspaceId,
    userId,
  });
}

/**
 * Enabling requires a usable Instagram connection.
 *
 * A workflow marked ACTIVE with no connected account can never receive an
 * event, so it would sit in the UI looking live and do nothing. Refusing here,
 * with a message that says why, is far better than the silence.
 */
export async function setEnabled(
  workspaceId: string,
  userId: string,
  id: string,
  enabled: boolean
): Promise<Workflow> {
  const workflow = await repo.findById(workspaceId, id);
  if (!workflow) throw AppError.notFound("That workflow");

  if (enabled) {
    const connected = await instagramRepo.countActiveAccounts(workspaceId);
    if (connected === 0) {
      throw AppError.accountUnavailable(
        "Connect an Instagram account before enabling this workflow."
      );
    }
    if (workflow.actions.length === 0) {
      throw AppError.validation("Add at least one action before enabling this workflow.");
    }
  }

  await repo.setStatus(workspaceId, id, enabled ? "ACTIVE" : "PAUSED");

  void audit.record({
    action: enabled ? "WORKFLOW_ENABLED" : "WORKFLOW_DISABLED",
    entityType: "WORKFLOW",
    entityId: id,
    workspaceId,
    userId,
    metadata: { name: workflow.name },
  });

  return get(workspaceId, id);
}

/**
 * Runs the workflow against a sample event, in DRY_RUN.
 *
 * The same engine, the same condition evaluation, the same action executors —
 * only the outbound provider call is suppressed. A test that took a different
 * path would be worth very little, because the thing a user wants to know is
 * whether their conditions match, and that has to be the real evaluator.
 */
export async function test(
  workspaceId: string,
  id: string,
  input: TestWorkflowRequest
): Promise<{ executionId: string | null; matched: boolean }> {
  const workflow = await repo.findById(workspaceId, id);
  if (!workflow) throw AppError.notFound("That workflow");

  const account = await instagramRepo.findAccountForWorkspace(workspaceId);

  // A synthetic event id, unique per run, so repeated tests are not
  // deduplicated against each other by the execution constraint.
  const now = new Date();

  // Built through the schema rather than cast, so a sample event is proven to
  // be the same shape a real one would be — a test that ran against a subtly
  // different payload would not be testing much.
  const event = normalizedEventSchema.parse({
    eventId: `test:${id}:${now.getTime()}`,
    platform: "INSTAGRAM",
    eventType: eventTypeFor(workflow.triggerType),
    recipientAccountId: account?.instagramUserId ?? "test",
    occurredAt: now.toISOString(),
    payload: buildSamplePayload(workflow.triggerType, input.sample),
  });

  const result = await runEvent(
    {
      workspaceId,
      instagramAccountId: account?.id ?? "test",
      event,
    },
    { mode: "DRY_RUN", webhookEventId: null }
  );

  return {
    executionId: result.executionIds[0] ?? null,
    matched: result.executed > 0,
  };
}

function eventTypeFor(trigger: string): "COMMENT" | "MESSAGE" | "MENTION" {
  switch (trigger) {
    case "MESSAGE_RECEIVED":
      return "MESSAGE";
    case "MENTION_RECEIVED":
      return "MENTION";
    default:
      return "COMMENT";
  }
}

function buildSamplePayload(
  trigger: string,
  sample: TestWorkflowRequest["sample"]
): Record<string, unknown> {
  const author = { id: "test_author", username: sample.authorUsername };

  switch (trigger) {
    case "MESSAGE_RECEIVED":
      return {
        type: "MESSAGE",
        messageId: `test_message_${Date.now()}`,
        conversationId: "test_author",
        text: sample.text,
        sender: author,
      };
    case "MENTION_RECEIVED":
      return {
        type: "MENTION",
        mentionId: `test_mention_${Date.now()}`,
        postId: sample.postId,
        text: sample.text,
        author,
      };
    default:
      return {
        type: "COMMENT",
        commentId: `test_comment_${Date.now()}`,
        postId: sample.postId,
        text: sample.text,
        author,
      };
  }
}
