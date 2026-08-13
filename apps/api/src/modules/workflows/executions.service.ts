import type { Paginated, WorkflowExecution } from "@socialpilot/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { buildPage, cursorFilter, decodeCursor } from "../../utils/cursor.js";

/**
 * Execution history.
 *
 * Cursor-paginated rather than offset-paginated: executions are append-heavy
 * and written in bursts, so an offset walk both repeats and skips rows while
 * the user is reading. See utils/cursor.ts for the keyset details.
 */

const EXECUTION_SELECT = {
  id: true,
  workflowId: true,
  workspaceId: true,
  webhookEventId: true,
  status: true,
  mode: true,
  skipReason: true,
  inputData: true,
  error: true,
  startedAt: true,
  completedAt: true,
  workflow: { select: { name: true } },
  actionResults: {
    select: {
      id: true,
      actionId: true,
      actionType: true,
      status: true,
      externalId: true,
      error: true,
      position: true,
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.WorkflowExecutionSelect;

type ExecutionRow = Prisma.WorkflowExecutionGetPayload<{ select: typeof EXECUTION_SELECT }>;

function toDto(row: ExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflow.name,
    workspaceId: row.workspaceId,
    eventId: row.webhookEventId,
    status: row.status,
    mode: row.mode,
    skipReason: row.skipReason,
    input: (row.inputData as Record<string, unknown> | null) ?? null,
    results: row.actionResults.map((result) => ({
      actionId: result.actionId ?? result.id,
      actionType: result.actionType,
      status: result.status,
      externalId: result.externalId,
      error: result.error,
    })),
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.completedAt
      ? row.completedAt.getTime() - row.startedAt.getTime()
      : null,
  };
}

export async function list(
  workspaceId: string,
  filters: { workflowId?: string; status?: string; cursor?: string; limit: number }
): Promise<Paginated<WorkflowExecution>> {
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;

  const rows = await prisma.workflowExecution.findMany({
    where: {
      workspaceId,
      ...(filters.workflowId ? { workflowId: filters.workflowId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(cursor ? cursorFilter(cursor, "startedAt") : {}),
    },
    select: EXECUTION_SELECT,
    // Matches the (workspaceId, startedAt) index, and the id tiebreak makes the
    // ordering total so the cursor cannot land mid-millisecond.
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    // One more than asked for: its presence is what distinguishes "last page"
    // from "a full page that ends exactly on the boundary".
    take: filters.limit + 1,
  });

  const page = buildPage(rows, filters.limit, (row) => row.startedAt);

  return { items: page.items.map(toDto), nextCursor: page.nextCursor };
}

export async function get(workspaceId: string, id: string): Promise<WorkflowExecution | null> {
  const row = await prisma.workflowExecution.findFirst({
    where: { id, workspaceId },
    select: EXECUTION_SELECT,
  });
  return row ? toDto(row) : null;
}
