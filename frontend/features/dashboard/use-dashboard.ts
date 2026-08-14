"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardRange } from "@/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspaceId } from "@/features/workspace/workspace-provider";

/**
 * The dashboard payload.
 *
 * Every number here is computed by the backend from rows it wrote. Nothing in
 * this file derives a metric — that is the whole point of the split.
 */
export function useDashboard(range: DashboardRange) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.dashboard(workspaceId ?? "none", range),
    queryFn: () => api.dashboard.getOverview(range, workspaceId),
    // Gated on the workspace: firing without one would let the server pick a
    // default and briefly render another tenant's figures under this name.
    enabled: Boolean(workspaceId),
  });
}

export function useActivity() {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.activity(workspaceId ?? "none"),
    queryFn: () => api.dashboard.getActivity(workspaceId),
    enabled: Boolean(workspaceId),
    // Shorter than the default: this is the panel a user watches after
    // enabling a workflow to see whether anything happened.
    staleTime: 15_000,
  });
}
