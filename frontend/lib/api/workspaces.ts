import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  WorkspaceMember,
  WorkspaceMembership,
} from "@/types";
import { http } from "./client";

export const workspaces = {
  /** Every workspace the caller belongs to, with a connected-account flag each. */
  list: () => http.get<{ workspaces: WorkspaceMembership[] }>("/api/workspaces"),

  create: (input: CreateWorkspaceRequest) =>
    http.post<{ workspace: WorkspaceMembership }>("/api/workspaces", input),

  /**
   * The server re-checks membership rather than trusting the caller's list,
   * then records the choice on the session so it survives the cookie.
   */
  switchTo: (workspaceId: string) =>
    http.post<{ workspace: WorkspaceMembership }>("/api/workspaces/switch", { workspaceId }),

  current: (workspaceId?: string | null) =>
    http.get<{ workspace: WorkspaceMembership }>("/api/workspaces/current", { workspaceId }),

  update: (input: UpdateWorkspaceRequest, workspaceId?: string | null) =>
    http.patch<{ workspace: WorkspaceMembership }>("/api/workspaces/current", input, {
      workspaceId,
    }),

  members: (workspaceId?: string | null) =>
    http.get<{ members: WorkspaceMember[] }>("/api/workspaces/current/members", { workspaceId }),
};
