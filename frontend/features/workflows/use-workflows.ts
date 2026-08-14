"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type {
  CreateWorkflowRequest,
  TestWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowStatus,
} from "@/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspaceId } from "@/features/workspace/workspace-provider";

export function useWorkflows(filters: { status?: WorkflowStatus; search?: string } = {}) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.workflows(workspaceId ?? "none", filters),
    queryFn: () => api.workflows.list(filters, workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useWorkflow(id: string | null) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.workflow(workspaceId ?? "none", id ?? "none"),
    queryFn: () => api.workflows.get(id as string, workspaceId),
    enabled: Boolean(workspaceId && id),
  });
}

export function useWorkflowExecutions(workflowId: string | null) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.executions(workspaceId ?? "none", { workflowId }),
    queryFn: () => api.workflows.executions(workflowId as string, workspaceId),
    enabled: Boolean(workspaceId && workflowId),
  });
}

export function useExecutions(filters: { status?: string } = {}) {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.executions(workspaceId ?? "none", filters),
    queryFn: () => api.workflows.allExecutions(filters, workspaceId),
    enabled: Boolean(workspaceId),
  });
}

/**
 * Invalidates everything a workflow write can affect.
 *
 * Enabling a workflow changes the list, that workflow's detail, and the
 * dashboard's active count — invalidating only the obvious one leaves stale
 * numbers on screen, which users notice and report as a bug long before anyone
 * finds the missing key.
 */
function useInvalidateWorkflows() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreateWorkflow() {
  const workspaceId = useWorkspaceId();
  const invalidate = useInvalidateWorkflows();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: CreateWorkflowRequest) => api.workflows.create(input, workspaceId),
    onSuccess: (data) => {
      invalidate();
      // Straight to the detail page: a new workflow is created as a draft, and
      // enabling it is the next thing the user needs to do.
      router.push(`/workflows/${data.workflow.id}`);
    },
  });
}

export function useUpdateWorkflow(id: string) {
  const workspaceId = useWorkspaceId();
  const invalidate = useInvalidateWorkflows();

  return useMutation({
    mutationFn: (input: UpdateWorkflowRequest) => api.workflows.update(id, input, workspaceId),
    onSuccess: invalidate,
  });
}

export function useSetWorkflowEnabled(id: string) {
  const workspaceId = useWorkspaceId();
  const invalidate = useInvalidateWorkflows();

  return useMutation({
    mutationFn: (enabled: boolean) => api.workflows.setEnabled(id, enabled, workspaceId),
    // No optimistic update. Enabling can legitimately fail — the server refuses
    // when no Instagram account is connected — and flipping the toggle first
    // would show the workflow as live when it never became live.
    onSuccess: invalidate,
  });
}

export function useDeleteWorkflow() {
  const workspaceId = useWorkspaceId();
  const invalidate = useInvalidateWorkflows();
  const router = useRouter();

  return useMutation({
    mutationFn: (id: string) => api.workflows.remove(id, workspaceId),
    onSuccess: () => {
      invalidate();
      router.push("/workflows");
    },
  });
}

export function useTestWorkflow(id: string) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sample: TestWorkflowRequest["sample"]) =>
      api.workflows.test(id, sample, workspaceId),
    onSuccess: () => {
      // A test run writes a DRY_RUN execution, which the history panel shows.
      void queryClient.invalidateQueries({ queryKey: ["executions"] });
    },
  });
}
