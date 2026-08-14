"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspaceId } from "@/features/workspace/workspace-provider";

export function useInstagramConnection() {
  const workspaceId = useWorkspaceId();

  return useQuery({
    queryKey: queryKeys.instagram(workspaceId ?? "none"),
    queryFn: () => api.instagram.getAccount(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

/**
 * Starts the OAuth flow.
 *
 * The server mints the authorize URL because only it can create and store the
 * CSRF `state` the callback verifies — and only it holds the app secret. The
 * browser is then navigated at the top level, because an XHR cannot follow a
 * redirect to a third-party consent screen.
 */
export function useConnectInstagram() {
  const workspaceId = useWorkspaceId();

  return useMutation({
    mutationFn: () => api.instagram.connect(workspaceId),
    onSuccess: (data) => {
      window.location.href = data.authorizeUrl;
    },
  });
}

export function useDisconnectInstagram() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => api.instagram.disconnect(accountId, workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["instagram"] });
      // Disconnecting changes the dashboard's connection card and the
      // switcher's per-workspace connection dot.
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}
