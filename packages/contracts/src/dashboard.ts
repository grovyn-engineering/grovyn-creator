import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";
import {
  executionStatusSchema,
  webhookEventTypeSchema,
  workflowStatusSchema,
} from "./enums.js";

/**
 * Every figure below is a count or a ratio over rows the product actually
 * writes — webhook events it received and executions it ran. There is no
 * reach, impression, follower, or engagement metric, because nothing in the
 * V1 data model produces one and a plausible-looking number the backend
 * cannot defend is worse than an empty state.
 */

export const dashboardRangeSchema = z.enum(["7d", "30d", "90d"]).default("30d");
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

export const DAYS_BY_RANGE: Record<Exclude<DashboardRange, undefined>, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const dashboardQuerySchema = z.object({
  range: dashboardRangeSchema,
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/**
 * A headline number with its own prior-period comparison. `previous` covers
 * the equally sized window immediately before the current one, so the delta
 * is like-for-like; it is null when there is no prior data to compare against
 * rather than being reported as a 100% rise from zero.
 */
export const metricSchema = z.object({
  value: z.number(),
  previous: z.number().nullable(),
});
export type Metric = z.infer<typeof metricSchema>;

export const dashboardSummarySchema = z.object({
  /** Inclusive window the figures cover, echoed back so the UI can label them. */
  range: z.enum(["7d", "30d", "90d"]),
  from: isoDateSchema,
  to: isoDateSchema,

  /** Connection health drives the dashboard's degraded state. */
  instagram: z.object({
    isConnected: z.boolean(),
    username: z.string().nullable(),
    status: z.string().nullable(),
    needsReconnect: z.boolean(),
  }),

  workflows: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
  }),

  executions: z.object({
    total: metricSchema,
    succeeded: metricSchema,
    failed: metricSchema,
    skipped: metricSchema,
    /**
     * Succeeded / (succeeded + failed), as a 0–1 fraction. Skipped runs are
     * excluded: a workflow correctly declining to act is not a failure, and
     * counting it as one would make a well-targeted workflow look broken.
     * Null when nothing has run — not 0, which would read as total failure.
     */
    successRate: z.number().min(0).max(1).nullable(),
  }),

  events: z.object({
    total: metricSchema,
    comments: metricSchema,
    messages: metricSchema,
    /** Received but not yet run through the engine. A backlog signal. */
    pending: z.number().int().min(0),
  }),

  /** Actions actually dispatched to Instagram, the closest thing to output. */
  actionsExecuted: metricSchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** One day in the executions-over-time series. Days with no runs are present as zeros. */
export const dashboardTrendPointSchema = z.object({
  /** `YYYY-MM-DD`, UTC. */
  date: z.string(),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type DashboardTrendPoint = z.infer<typeof dashboardTrendPointSchema>;

export const dashboardTrendSchema = z.object({
  points: z.array(dashboardTrendPointSchema),
});
export type DashboardTrend = z.infer<typeof dashboardTrendSchema>;

/** Per-workflow performance, so a single failing workflow is visible at a glance. */
export const workflowPerformanceSchema = z.object({
  workflowId: idSchema,
  name: z.string(),
  status: workflowStatusSchema,
  executions: z.number().int().min(0),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  successRate: z.number().min(0).max(1).nullable(),
  lastExecutedAt: isoDateSchema.nullable(),
});
export type WorkflowPerformance = z.infer<typeof workflowPerformanceSchema>;

/**
 * The recent-activity feed. One row per execution, newest first, bounded —
 * it is a feed, not an export, and the executions page exists for the rest.
 */
export const activityItemSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  workflowName: z.string(),
  status: executionStatusSchema,
  eventType: webhookEventTypeSchema.nullable(),
  /** One-line human summary, e.g. `@someone commented "how much?"`. */
  summary: z.string(),
  error: z.string().nullable(),
  occurredAt: isoDateSchema,
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
