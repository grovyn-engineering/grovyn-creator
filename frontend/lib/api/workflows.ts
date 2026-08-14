import type {
  CreateWorkflowRequest,
  Paginated,
  UpdateWorkflowRequest,
  Workflow,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowSummary,
  TestWorkflowRequest,
} from "@/types";
import { http } from "./client";

export const workflows = {
  list: (
    filters: { status?: WorkflowStatus; search?: string } = {},
    workspaceId?: string | null
  ) =>
    http.get<{ workflows: WorkflowSummary[] }>("/api/workflows", {
      workspaceId,
      query: { status: filters.status, search: filters.search },
    }),

  get: (id: string, workspaceId?: string | null) =>
    http.get<{ workflow: Workflow }>(`/api/workflows/${id}`, { workspaceId }),

  create: (input: CreateWorkflowRequest, workspaceId?: string | null) =>
    http.post<{ workflow: Workflow }>("/api/workflows", input, { workspaceId }),

  /** Replaces conditions and actions wholesale rather than patching them. */
  update: (id: string, input: UpdateWorkflowRequest, workspaceId?: string | null) =>
    http.patch<{ workflow: Workflow }>(`/api/workflows/${id}`, input, { workspaceId }),

  remove: (id: string, workspaceId?: string | null) =>
    http.delete<void>(`/api/workflows/${id}`, { workspaceId }),

  /**
   * Enabling is refused by the server when no Instagram account is connected —
   * a workflow marked ACTIVE with nothing feeding it would look live forever.
   */
  setEnabled: (id: string, enabled: boolean, workspaceId?: string | null) =>
    http.post<{ workflow: Workflow }>(
      `/api/workflows/${id}/${enabled ? "enable" : "disable"}`,
      undefined,
      { workspaceId }
    ),

  /**
   * Runs the real engine in DRY_RUN — same matching, same evaluation, only the
   * outbound Instagram call suppressed.
   */
  test: (id: string, sample: TestWorkflowRequest["sample"], workspaceId?: string | null) =>
    http.post<{ executionId: string | null; matched: boolean }>(
      `/api/workflows/${id}/test`,
      { sample },
      { workspaceId }
    ),

  executions: (id: string, workspaceId?: string | null, limit = 25) =>
    http.get<Paginated<WorkflowExecution>>(`/api/workflows/${id}/executions`, {
      workspaceId,
      query: { limit },
    }),

  allExecutions: (
    filters: { status?: string; workflowId?: string; cursor?: string } = {},
    workspaceId?: string | null,
    limit = 50
  ) =>
    http.get<Paginated<WorkflowExecution>>("/api/workflows/executions", {
      workspaceId,
      query: { limit, ...filters },
    }),
};
