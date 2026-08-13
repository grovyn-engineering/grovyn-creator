import { Prisma } from "@prisma/client";
import type {
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowStatus,
} from "@socialpilot/contracts";
import type { Db } from "../../config/prisma.js";
import { prisma } from "../../config/prisma.js";

/**
 * Workflow persistence.
 *
 * Every method takes `workspaceId` as a required first argument. That is not a
 * convention — it is the structural answer to the defect found in the audited
 * system, where the tenant filter was an `.eq()` that had to be remembered on
 * each query and was documented with a comment warning what happened if it were
 * forgotten. Here a query that is not tenant-scoped cannot be expressed.
 */

const WITH_CHILDREN = {
  conditions: { orderBy: { position: "asc" } },
  actions: { orderBy: { position: "asc" } },
} satisfies Prisma.WorkflowInclude;

export type WorkflowWithChildren = Prisma.WorkflowGetPayload<{ include: typeof WITH_CHILDREN }>;

export function findById(
  workspaceId: string,
  id: string,
  db: Db = prisma
): Promise<WorkflowWithChildren | null> {
  return db.workflow.findFirst({ where: { id, workspaceId }, include: WITH_CHILDREN });
}

/**
 * The workflows list.
 *
 * Counts and the last-execution timestamp come back in the same query rather
 * than as a follow-up per row — the audited system fetched related rows
 * unbounded and reduced them in memory, which is fine at ten workflows and a
 * full table scan at ten thousand.
 */
export async function list(
  workspaceId: string,
  filters: { status?: WorkflowStatus; search?: string } = {},
  db: Db = prisma
) {
  return db.workflow.findMany({
    where: {
      workspaceId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search
        ? { name: { contains: filters.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
    },
    include: {
      _count: { select: { conditions: true, actions: true, executions: true } },
      executions: {
        select: { startedAt: true },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Creates the workflow and its children atomically.
 *
 * A workflow whose conditions committed but whose actions did not would be
 * live, match events, and do nothing — a silent failure that looks like a bug
 * in the product rather than a partial write. Nested `create` puts all three
 * inserts in one statement group inside the caller's transaction.
 */
export function create(
  workspaceId: string,
  input: CreateWorkflowRequest,
  db: Db = prisma
): Promise<WorkflowWithChildren> {
  return db.workflow.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      // New workflows start disabled. Creating one that immediately begins
      // acting on a live account is not a surprise anybody wants.
      status: "DRAFT",
      conditions: {
        create: input.conditions.map((condition, position) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          position,
        })),
      },
      actions: {
        create: input.actions.map((action, position) => ({
          actionType: action.actionType,
          configuration: action.configuration as Prisma.InputJsonValue,
          position,
        })),
      },
    },
    include: WITH_CHILDREN,
  });
}

/**
 * Replaces the workflow and its children wholesale.
 *
 * Delete-then-recreate rather than diffing. Reconciling two ordered
 * collections by identity is a large surface for partial-write bugs, and the
 * builder always submits the complete list anyway. Execution history survives
 * because `WorkflowExecutionAction.actionId` is `SetNull` and the action type
 * is snapshotted on the result row.
 */
export async function replace(
  workspaceId: string,
  id: string,
  input: UpdateWorkflowRequest,
  db: Db = prisma
): Promise<WorkflowWithChildren> {
  // Scoped delete: an id from another tenant matches nothing here rather than
  // deleting that tenant's children.
  await db.workflowCondition.deleteMany({ where: { workflowId: id, workflow: { workspaceId } } });
  await db.workflowAction.deleteMany({ where: { workflowId: id, workflow: { workspaceId } } });

  return db.workflow.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      conditions: {
        create: input.conditions.map((condition, position) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          position,
        })),
      },
      actions: {
        create: input.actions.map((action, position) => ({
          actionType: action.actionType,
          configuration: action.configuration as Prisma.InputJsonValue,
          position,
        })),
      },
    },
    include: WITH_CHILDREN,
  });
}

export function setStatus(
  workspaceId: string,
  id: string,
  status: WorkflowStatus,
  db: Db = prisma
): Promise<{ count: number }> {
  // updateMany with workspaceId in the predicate: the tenant check and the
  // write are one statement, and a foreign id updates zero rows.
  return db.workflow.updateMany({ where: { id, workspaceId }, data: { status } });
}

export function remove(
  workspaceId: string,
  id: string,
  db: Db = prisma
): Promise<{ count: number }> {
  return db.workflow.deleteMany({ where: { id, workspaceId } });
}

export function countByStatus(workspaceId: string, db: Db = prisma) {
  return db.workflow.groupBy({
    by: ["status"],
    where: { workspaceId },
    _count: { _all: true },
  });
}
