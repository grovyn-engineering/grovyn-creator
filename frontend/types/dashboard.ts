import type { ExecutionStatus, WebhookEventType, WorkflowStatus } from "./enums";

/**
 * Mirrors `backend/src/contracts/dashboard.ts`.
 *
 * Every figure is a count or ratio the backend computed from rows it actually
 * wrote. There is no reach, impression, or follower metric, because nothing in
 * the data model produces one.
 */

export const DASHBOARD_RANGES = ["7d", "30d", "90d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/**
 * A headline number with its prior-period comparison. `previous` is null when
 * there is no prior data — reported as "no comparison" rather than as a rise
 * from zero, which would make every new account look like a rocket ship.
 */
export interface Metric {
  value: number;
  previous: number | null;
}

export interface DashboardSummary {
  range: DashboardRange;
  from: string;
  to: string;

  instagram: {
    isConnected: boolean;
    username: string | null;
    status: string | null;
    needsReconnect: boolean;
  };

  workflows: {
    total: number;
    active: number;
  };

  executions: {
    total: Metric;
    succeeded: Metric;
    failed: Metric;
    skipped: Metric;
    /**
     * succeeded / (succeeded + failed), 0–1. Skipped runs are excluded — a
     * workflow correctly declining to act is not a failure. Null when nothing
     * has run, not 0, which would read as total failure.
     */
    successRate: number | null;
  };

  events: {
    total: Metric;
    comments: Metric;
    messages: Metric;
    /** Received but not yet run through the engine. A backlog signal. */
    pending: number;
  };

  actionsExecuted: Metric;
}

/** One day in the trend series. Days with no runs are present as zeros. */
export interface DashboardTrendPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface DashboardTrend {
  points: DashboardTrendPoint[];
}

export interface WorkflowPerformance {
  workflowId: string;
  name: string;
  status: WorkflowStatus;
  executions: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  lastExecutedAt: string | null;
}

export interface ActivityItem {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  eventType: WebhookEventType | null;
  /** One-line human summary, e.g. `@someone commented "how much?"`. */
  summary: string;
  error: string | null;
  occurredAt: string;
}
