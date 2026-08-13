import { prisma } from "../../config/prisma.js";
import type { Window } from "../../utils/dates.js";

/**
 * Dashboard aggregates.
 *
 * Every figure is computed by the database. The audited system derived its
 * KPIs inside a 968-line React component from raw, unbounded rows shipped to
 * the browser; that is both a correctness problem — the numbers depend on what
 * the client happened to receive — and a scaling one. Here the client receives
 * numbers it does not compute.
 */

export interface StatusCounts {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const EMPTY_COUNTS: StatusCounts = { total: 0, succeeded: 0, failed: 0, skipped: 0 };

/**
 * Execution counts by status for a window, in one grouped query rather than
 * four counts. Uses the (workspaceId, status, startedAt) index.
 */
export async function executionCounts(
  workspaceId: string,
  window: Window
): Promise<StatusCounts> {
  const rows = await prisma.workflowExecution.groupBy({
    by: ["status"],
    where: {
      workspaceId,
      startedAt: { gte: window.from, lt: window.to },
      // Test runs are excluded from every headline figure. Counting them would
      // let a user inflate their own success rate by pressing Test, and would
      // make the dashboard disagree with what actually happened on Instagram.
      mode: "LIVE",
    },
    _count: { _all: true },
  });

  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    const n = row._count._all;
    counts.total += n;
    if (row.status === "SUCCESS") counts.succeeded += n;
    else if (row.status === "FAILED") counts.failed += n;
    else if (row.status === "SKIPPED") counts.skipped += n;
  }
  return counts;
}

export interface EventCounts {
  total: number;
  comments: number;
  messages: number;
}

export async function eventCounts(workspaceId: string, window: Window): Promise<EventCounts> {
  const rows = await prisma.webhookEvent.groupBy({
    by: ["eventType"],
    where: { workspaceId, createdAt: { gte: window.from, lt: window.to } },
    _count: { _all: true },
  });

  const counts: EventCounts = { total: 0, comments: 0, messages: 0 };
  for (const row of rows) {
    const n = row._count._all;
    counts.total += n;
    if (row.eventType === "COMMENT") counts.comments += n;
    else if (row.eventType === "MESSAGE") counts.messages += n;
  }
  return counts;
}

/** Events received but not yet run through the engine — a backlog signal. */
export function pendingEventCount(workspaceId: string): Promise<number> {
  return prisma.webhookEvent.count({ where: { workspaceId, processed: false } });
}

/**
 * Actions actually dispatched, which is the closest thing the product has to
 * an output metric. Counts individual action results, not executions, because
 * one execution can reply and DM.
 */
export function actionsExecutedCount(workspaceId: string, window: Window): Promise<number> {
  return prisma.workflowExecutionAction.count({
    where: {
      status: "SUCCESS",
      startedAt: { gte: window.from, lt: window.to },
      execution: { workspaceId, mode: "LIVE" },
    },
  });
}

export interface TrendRow {
  day: Date;
  status: string;
  count: bigint;
}

/**
 * Daily execution counts by status.
 *
 * Raw SQL because Prisma's `groupBy` cannot group on a computed expression,
 * and truncating to a day is exactly that. Bucketing in application code would
 * mean fetching every row in the window — which is the pattern this dashboard
 * exists to avoid.
 *
 * `date_trunc(... AT TIME ZONE 'UTC')` rather than the server's zone, so the
 * same data produces the same chart in every deployment.
 */
export function executionTrend(workspaceId: string, window: Window): Promise<TrendRow[]> {
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      date_trunc('day', "startedAt" AT TIME ZONE 'UTC') AS day,
      "status"::text AS status,
      COUNT(*) AS count
    FROM "workflow_executions"
    WHERE "workspaceId" = ${workspaceId}
      AND "startedAt" >= ${window.from}
      AND "startedAt" <  ${window.to}
      AND "mode" = 'LIVE'::"ExecutionMode"
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;
}

/**
 * Per-workflow performance, so one failing workflow is visible without opening
 * each in turn. Aggregated by the database and capped — this is a summary
 * panel, and the workflows page exists for the full list.
 */
export function workflowPerformance(workspaceId: string, window: Window, limit = 8) {
  return prisma.workflow.findMany({
    where: {
      workspaceId,
      executions: { some: { startedAt: { gte: window.from, lt: window.to }, mode: "LIVE" } },
    },
    select: {
      id: true,
      name: true,
      status: true,
      executions: {
        where: { startedAt: { gte: window.from, lt: window.to }, mode: "LIVE" },
        select: { status: true, startedAt: true },
      },
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * The recent-activity feed: newest executions with enough context to render a
 * line each. Bounded — it is a feed, not an export.
 */
export function recentActivity(workspaceId: string, limit: number) {
  return prisma.workflowExecution.findMany({
    where: { workspaceId, mode: "LIVE" },
    select: {
      id: true,
      status: true,
      error: true,
      skipReason: true,
      startedAt: true,
      workflowId: true,
      workflow: { select: { name: true } },
      webhookEvent: { select: { eventType: true, normalized: true } },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

export function workflowCounts(workspaceId: string) {
  return prisma.workflow.groupBy({
    by: ["status"],
    where: { workspaceId },
    _count: { _all: true },
  });
}

/**
 * Connection status for the header card.
 *
 * Selects an explicit column list. This is the query the audited system got
 * wrong — its equivalent used `select("*")` and shipped a channel's webhook
 * secret to the browser. `accessTokenEncrypted` is not in this list and adding
 * it would be obviously wrong at the point of edit.
 */
export function connectionStatus(workspaceId: string) {
  return prisma.instagramAccount.findFirst({
    where: { workspaceId },
    select: { username: true, status: true },
    orderBy: { connectedAt: "desc" },
  });
}
