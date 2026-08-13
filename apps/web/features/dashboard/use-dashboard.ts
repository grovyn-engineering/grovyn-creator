"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  ActivityItem,
  DashboardRange,
  DashboardSummary,
  DashboardTrend,
  WorkflowPerformance,
} from "@socialpilot/contracts";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspaceId } from "@/features/workspace/workspace-provider";

interface DashboardResponse {
  summary: DashboardSummary;
  trend: DashboardTrend;
  workflows: WorkflowPerformance[];
}

/**
 * The dashboard payload.
 *
 * Every number here is computed by the API from rows it wrote. Nothing in this
 * file derives a metric — that is the whole point of the split, and it is the
 * specific thing the audited system got wrong by computing KPIs inside a
 * 968-line React component from unbounded raw rows.
 */
export function useDashboard(range: DashboardRange) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.dashboard(workspaceId ?? "none", range),
    queryFn: () =>
      api.get<DashboardResponse>("/api/dashboard", {
        workspaceId,
        query: { range },
      }),
    // Gated on the workspace: firing without one would let the server pick a
    // default and briefly render another tenant's figures under this name.
    enabled: Boolean(workspaceId),
  });
}

export function useActivity() {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.activity(workspaceId ?? "none"),
    queryFn: () =>
      api.get<{ activity: ActivityItem[] }>("/api/dashboard/activity", { workspaceId }),
    enabled: Boolean(workspaceId),
    // Shorter than the default: this is the panel a user watches after
    // enabling a workflow to see whether anything happened.
    staleTime: 15_000,
  });
}
