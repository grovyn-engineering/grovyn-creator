import { z } from "zod";
import type { WorkspaceRole } from "./enums";

/** Mirrors `backend/src/contracts/workspace.ts`. */

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(60, "Workspace names are limited to 60 characters.");

export const createWorkspaceRequestSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({ name: workspaceNameSchema });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

export interface Workspace {
  id: string;
  name: string;
  /** Derived server-side from the name; never client-supplied. */
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/** A workspace plus the caller's own relationship to it, for the switcher. */
export interface WorkspaceMembership extends Workspace {
  role: WorkspaceRole;
  /** Drives the connection dot beside each workspace in the switcher. */
  hasConnectedAccount: boolean;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  name: string;
  email: string;
  createdAt: string;
}
