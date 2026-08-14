import type {
  ActivityItem,
  DashboardRange,
  DashboardSummary,
  DashboardTrend,
  WorkflowPerformance,
} from "@/types";
import { http } from "./client";

export interface DashboardOverview {
  summary: DashboardSummary;
  trend: DashboardTrend;
  workflows: WorkflowPerformance[];
}

export const dashboard = {
  /**
   * Summary, trend and per-workflow performance arrive together because the
   * dashboard renders them as one view — splitting them would mean three round
   * trips and three loading states for a single screen.
   *
   * Every figure is aggregated by the backend in SQL. Nothing here computes a
   * metric.
   */
  getOverview: (range: DashboardRange, workspaceId?: string | null) =>
    http.get<DashboardOverview>("/api/dashboard", { workspaceId, query: { range } }),

  getActivity: (workspaceId?: string | null) =>
    http.get<{ activity: ActivityItem[] }>("/api/dashboard/activity", { workspaceId }),
};
