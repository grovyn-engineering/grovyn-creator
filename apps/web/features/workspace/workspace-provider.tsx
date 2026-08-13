"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { WorkspaceMembership } from "@socialpilot/contracts";
import { api } from "@/lib/api-client";
import { WORKSPACE_SCOPED_PREFIXES, queryKeys } from "@/lib/query-keys";

/**
 * Active-workspace state, and the switch.
 *
 * The behaviour here is the piece carried over from the audited system, with
 * its two defects removed. What is kept:
 *
 *   - the active workspace is a claim the server validates against membership
 *     on every request, never something the client is trusted about;
 *   - switching re-renders rather than reloading the page;
 *   - a workspace the user no longer belongs to degrades to their default
 *     rather than erroring.
 *
 * What is not kept: the original resolved and, when necessary, *created* a
 * workspace during a page render, behind an admin credential that bypassed
 * row-level security. Here signup creates the workspace transactionally, so
 * this read path only ever reads.
 */

interface WorkspaceContextValue {
  workspaces: WorkspaceMembership[];
  current: WorkspaceMembership | null;
  isLoading: boolean;
  error: Error | null;
  switchTo: (workspaceId: string) => void;
  isSwitching: boolean;
  /** The workspace mid-switch, so the switcher can show which row is pending. */
  switchingTo: string | null;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

/** Mirrors the API's cookie name. Read only to pick the initial selection. */
const WORKSPACE_COOKIE = "sp_workspace";

function readWorkspaceCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)sp_workspace=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => api.get<{ workspaces: WorkspaceMembership[] }>("/api/workspaces"),
    staleTime: 60_000,
  });

  const workspaces = React.useMemo(() => query.data?.workspaces ?? [], [query.data]);

  /**
   * Resolution order: an explicit in-session selection, then the cookie, then
   * the first workspace. Each candidate is checked against the list the server
   * returned — a cookie naming a workspace the user has left simply falls
   * through, which is the validate-before-trust rule applied on the client too.
   */
  const current = React.useMemo(() => {
    if (workspaces.length === 0) return null;

    const candidates = [selectedId, readWorkspaceCookie()];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const match = workspaces.find((workspace) => workspace.id === candidate);
      if (match) return match;
    }

    return workspaces[0] ?? null;
  }, [workspaces, selectedId]);

  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) =>
      api.post<{ workspace: WorkspaceMembership }>("/api/workspaces/switch", { workspaceId }),

    onMutate: (workspaceId) => setSwitchingTo(workspaceId),

    onSuccess: (data) => {
      setSelectedId(data.workspace.id);

      // Invalidate by prefix rather than clearing the cache. Every
      // workspace-scoped key carries the workspace id, so the old tenant's data
      // is already unreachable — but the queries currently mounted still hold
      // the previous id and need to refetch under the new one. The session
      // query is workspace-independent and is deliberately left alone.
      for (const prefix of WORKSPACE_SCOPED_PREFIXES) {
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      }

      // Re-runs server components without a full navigation, so the switch
      // keeps scroll position and client state. Not `window.location.assign`,
      // which would throw the whole tree away.
      router.refresh();
    },

    onSettled: () => setSwitchingTo(null),
  });

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      current,
      isLoading: query.isLoading,
      error: query.error,
      switchTo: (workspaceId: string) => {
        if (workspaceId === current?.id) return;
        switchMutation.mutate(workspaceId);
      },
      isSwitching: switchMutation.isPending,
      switchingTo,
    }),
    [workspaces, current, query.isLoading, query.error, switchMutation, switchingTo]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = React.useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}

/**
 * The active workspace id, for query keys and request scoping.
 *
 * Returns null while workspaces are loading. Callers gate their queries on it
 * with `enabled`, so no request is ever sent without a workspace — which would
 * otherwise silently fall back to the server's default and show the wrong
 * tenant's data for one render.
 */
export function useWorkspaceId(): string | null {
  return useWorkspace().current?.id ?? null;
}

export { WORKSPACE_COOKIE };
