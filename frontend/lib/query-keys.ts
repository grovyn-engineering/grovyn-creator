/**
 * Query keys, defined in one place.
 *
 * Every workspace-scoped key carries the workspace id as its second element.
 * That is what makes switching workspaces correct rather than merely fast: the
 * cache for workspace A and workspace B are different keys, so a switch shows
 * B's data or a loading state — never A's numbers under B's name, which is the
 * failure mode a naive `["dashboard"]` key produces and which is very hard to
 * notice in review.
 */
export const queryKeys = {
  session: ["session"] as const,

  workspaces: ["workspaces"] as const,

  dashboard: (workspaceId: string, range: string) =>
    ["dashboard", workspaceId, range] as const,

  activity: (workspaceId: string) => ["dashboard", workspaceId, "activity"] as const,

  instagram: (workspaceId: string) => ["instagram", workspaceId] as const,

  instagramMedia: (workspaceId: string) => ["instagram", workspaceId, "media"] as const,

  workflows: (workspaceId: string, filters?: Record<string, unknown>) =>
    ["workflows", workspaceId, filters ?? {}] as const,

  workflow: (workspaceId: string, id: string) => ["workflows", workspaceId, "detail", id] as const,

  executions: (workspaceId: string, filters?: Record<string, unknown>) =>
    ["executions", workspaceId, filters ?? {}] as const,

  events: (workspaceId: string, filters?: Record<string, unknown>) =>
    ["events", workspaceId, filters ?? {}] as const,
};

/**
 * Prefixes for bulk invalidation after a workspace switch. Invalidating by
 * prefix rather than removing everything keeps the session query — which is
 * workspace-independent — from being refetched on every switch.
 */
export const WORKSPACE_SCOPED_PREFIXES = [
  "dashboard",
  "instagram",
  "workflows",
  "executions",
  "events",
] as const;
