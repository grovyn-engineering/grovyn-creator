import type {
  InstagramAuthorizeUrl,
  InstagramConnection,
  InstagramMedia,
  Paginated,
  WebhookEventSummary,
} from "@/types";
import { http } from "./client";

export const instagram = {
  /**
   * Connection state. `isConnected` is computed by the backend from the account
   * row's status — the UI branches on that and never derives connectedness
   * itself, so a disconnected or expired row cannot render as live.
   */
  getAccount: (workspaceId?: string | null) =>
    http.get<InstagramConnection>("/api/instagram", { workspaceId }),

  /**
   * Returns the authorize URL rather than redirecting.
   *
   * Only the server can mint and store the CSRF `state` the callback verifies,
   * and only it holds the app secret. The caller navigates the top window —
   * an XHR cannot follow a redirect to a third-party consent screen.
   */
  connect: (workspaceId?: string | null) =>
    http.get<InstagramAuthorizeUrl>("/api/instagram/connect", { workspaceId }),

  disconnect: (accountId: string, workspaceId?: string | null) =>
    http.delete<void>(`/api/instagram/${accountId}`, { workspaceId }),

  /** Recent posts, to populate the post picker when building a condition. */
  media: (workspaceId?: string | null) =>
    http.get<{ media: InstagramMedia[] }>("/api/instagram/media", { workspaceId }),

  /**
   * Received webhook events with per-event execution counts. Zero runs against
   * a received comment is the diagnosis: the event arrived and nothing matched.
   */
  events: (
    filters: { eventType?: string; cursor?: string } = {},
    workspaceId?: string | null,
    limit = 50
  ) =>
    http.get<Paginated<WebhookEventSummary>>("/api/events", {
      workspaceId,
      query: { limit, ...filters },
    }),
};
