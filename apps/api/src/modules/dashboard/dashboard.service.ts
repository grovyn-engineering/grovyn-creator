import type {
  ActivityItem,
  DashboardRange,
  DashboardSummary,
  DashboardTrendPoint,
  Metric,
  WorkflowPerformance,
} from "@socialpilot/contracts";
import { DAYS_BY_RANGE, normalizedEventSchema } from "@socialpilot/contracts";
import { comparisonWindows, toUtcDateKey, utcDateKeysBetween } from "../../utils/dates.js";
import { summarize } from "../../engine/normalizer.js";
import * as repo from "./dashboard.repository.js";

/**
 * Dashboard composition.
 *
 * Only figures the backend can defend from rows it actually wrote. There is no
 * reach, impression, follower, or engagement metric, because nothing in the V1
 * data model produces one — a plausible-looking number with nothing behind it
 * is worse than an honest empty state.
 */

function metric(value: number, previous: number | null): Metric {
  return { value, previous };
}

export async function getSummary(
  workspaceId: string,
  range: DashboardRange
): Promise<DashboardSummary> {
  const days = DAYS_BY_RANGE[range];
  const { current, previous } = comparisonWindows(new Date(), days);

  // One batch. The audited system originally issued two serial `Promise.all`
  // groups and had to be fixed; starting from one avoids reintroducing it.
  const [
    currentExecutions,
    previousExecutions,
    currentEvents,
    previousEvents,
    pendingEvents,
    currentActions,
    previousActions,
    workflowGroups,
    connection,
  ] = await Promise.all([
    repo.executionCounts(workspaceId, current),
    repo.executionCounts(workspaceId, previous),
    repo.eventCounts(workspaceId, current),
    repo.eventCounts(workspaceId, previous),
    repo.pendingEventCount(workspaceId),
    repo.actionsExecutedCount(workspaceId, current),
    repo.actionsExecutedCount(workspaceId, previous),
    repo.workflowCounts(workspaceId),
    repo.connectionStatus(workspaceId),
  ]);

  const totalWorkflows = workflowGroups.reduce((sum, row) => sum + row._count._all, 0);
  const activeWorkflows =
    workflowGroups.find((row) => row.status === "ACTIVE")?._count._all ?? 0;

  const isConnected = connection?.status === "ACTIVE";

  return {
    range,
    from: current.from.toISOString(),
    to: current.to.toISOString(),

    instagram: {
      isConnected,
      username: connection?.username ?? null,
      status: connection?.status ?? null,
      // A row that exists but is not ACTIVE is the reconnect case; no row at
      // all is the first-run case, and the UI says different things for each.
      needsReconnect: Boolean(connection) && !isConnected,
    },

    workflows: { total: totalWorkflows, active: activeWorkflows },

    executions: {
      total: metric(currentExecutions.total, previousExecutions.total),
      succeeded: metric(currentExecutions.succeeded, previousExecutions.succeeded),
      failed: metric(currentExecutions.failed, previousExecutions.failed),
      skipped: metric(currentExecutions.skipped, previousExecutions.skipped),
      successRate: successRate(currentExecutions.succeeded, currentExecutions.failed),
    },

    events: {
      total: metric(currentEvents.total, previousEvents.total),
      comments: metric(currentEvents.comments, previousEvents.comments),
      messages: metric(currentEvents.messages, previousEvents.messages),
      pending: pendingEvents,
    },

    actionsExecuted: metric(currentActions, previousActions),
  };
}

/**
 * Skipped runs are excluded from the denominator on purpose. A workflow
 * correctly declining to act on an irrelevant comment is the system working;
 * counting it as a non-success would make a well-targeted workflow look
 * broken, and would punish users for writing precise conditions.
 *
 * Null when nothing ran — not 0, which reads as total failure.
 */
function successRate(succeeded: number, failed: number): number | null {
  const attempted = succeeded + failed;
  if (attempted === 0) return null;
  return succeeded / attempted;
}

export async function getTrend(
  workspaceId: string,
  range: DashboardRange
): Promise<DashboardTrendPoint[]> {
  const days = DAYS_BY_RANGE[range];
  const { current } = comparisonWindows(new Date(), days);

  const rows = await repo.executionTrend(workspaceId, current);

  // Zero-filled across the whole window. A day with no runs must be a point at
  // the baseline, not a missing point the chart would interpolate straight
  // through — that would draw activity that never happened.
  const buckets = new Map<string, DashboardTrendPoint>();
  for (const key of utcDateKeysBetween(current.from, current.to)) {
    buckets.set(key, { date: key, succeeded: 0, failed: 0, skipped: 0 });
  }

  for (const row of rows) {
    const key = toUtcDateKey(row.day);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    // COUNT(*) comes back as bigint from raw SQL.
    const count = Number(row.count);
    if (row.status === "SUCCESS") bucket.succeeded += count;
    else if (row.status === "FAILED") bucket.failed += count;
    else if (row.status === "SKIPPED") bucket.skipped += count;
  }

  return [...buckets.values()];
}

export async function getWorkflowPerformance(
  workspaceId: string,
  range: DashboardRange
): Promise<WorkflowPerformance[]> {
  const days = DAYS_BY_RANGE[range];
  const { current } = comparisonWindows(new Date(), days);

  const rows = await repo.workflowPerformance(workspaceId, current);

  return rows
    .map((row) => {
      let succeeded = 0;
      let failed = 0;
      let lastExecutedAt: Date | null = null;

      for (const execution of row.executions) {
        if (execution.status === "SUCCESS") succeeded += 1;
        else if (execution.status === "FAILED") failed += 1;
        if (!lastExecutedAt || execution.startedAt > lastExecutedAt) {
          lastExecutedAt = execution.startedAt;
        }
      }

      return {
        workflowId: row.id,
        name: row.name,
        status: row.status,
        executions: row.executions.length,
        succeeded,
        failed,
        successRate: successRate(succeeded, failed),
        lastExecutedAt: lastExecutedAt ? lastExecutedAt.toISOString() : null,
      };
    })
    // Most active first — that is what a person scanning this panel wants.
    .sort((a, b) => b.executions - a.executions);
}

export async function getActivity(workspaceId: string, limit = 12): Promise<ActivityItem[]> {
  const rows = await repo.recentActivity(workspaceId, limit);

  return rows.map((row) => {
    // The stored normalized event may predate the current schema, so it is
    // parsed rather than trusted; a feed row is not worth crashing the
    // dashboard over.
    const parsed = row.webhookEvent?.normalized
      ? normalizedEventSchema.safeParse(row.webhookEvent.normalized)
      : null;

    return {
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflow.name,
      status: row.status,
      eventType: row.webhookEvent?.eventType ?? null,
      summary: parsed?.success ? summarize(parsed.data) : fallbackSummary(row.status),
      error: row.error ?? row.skipReason,
      occurredAt: row.startedAt.toISOString(),
    };
  });
}

function fallbackSummary(status: string): string {
  return status === "SKIPPED" ? "Conditions did not match" : "Workflow ran";
}
