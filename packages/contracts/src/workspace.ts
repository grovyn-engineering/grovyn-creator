import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";
import { workspaceRoleSchema } from "./enums.js";

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(60, "Workspace names are limited to 60 characters.");

/**
 * Slugs are derived server-side from the name and are never accepted from the
 * client — a client-chosen slug is a namespace the client does not own.
 */
export const workspaceSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  ownerId: idSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

/**
 * A workspace as it appears in the switcher: the workspace plus the caller's
 * own relationship to it. `role` is the caller's role, not the owner's.
 */
export const workspaceMembershipSchema = workspaceSchema.extend({
  role: workspaceRoleSchema,
  /** Denormalized for the switcher, which shows a connection dot per workspace. */
  hasConnectedAccount: z.boolean(),
});
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: workspaceNameSchema,
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({
  name: workspaceNameSchema,
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

export const switchWorkspaceRequestSchema = z.object({
  workspaceId: idSchema,
});
export type SwitchWorkspaceRequest = z.infer<typeof switchWorkspaceRequestSchema>;

export const workspaceMemberSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  userId: idSchema,
  role: workspaceRoleSchema,
  name: z.string(),
  email: z.string(),
  createdAt: isoDateSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
