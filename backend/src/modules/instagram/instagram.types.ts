/**
 * Types for the Instagram integration.
 *
 * Verified against Meta's "Instagram API with Instagram Login" documentation
 * (see docs/meta-instagram.md for the citations and dates). Two details are
 * easy to get wrong and are called out here because they cost a full debugging
 * cycle each:
 *
 *  - The host is `graph.instagram.com`, not `graph.facebook.com`. The latter is
 *    for the older "Instagram API with Facebook Login" product and rejects
 *    these tokens.
 *  - Token exchange and refresh live on unversioned paths
 *    (`/access_token`, `/refresh_access_token`), while resource endpoints are
 *    versioned. Prefixing the former with `/v23.0` returns a confusing 400.
 */

export const INSTAGRAM_AUTH_HOST = "https://www.instagram.com";
export const INSTAGRAM_OAUTH_HOST = "https://api.instagram.com";
export const INSTAGRAM_GRAPH_HOST = "https://graph.instagram.com";

/**
 * Scopes requested at authorization.
 *
 * `instagram_business_basic` is required for any call at all — it is what
 * grants the profile read used to identify the connected account.
 * `..._manage_comments` covers reading and replying to comments;
 * `..._manage_messages` covers direct messages. Content publishing is not
 * requested: V1 never posts, and asking for a permission the product does not
 * exercise is a guaranteed App Review rejection.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
] as const;

// ── OAuth responses ──────────────────────────────────────────────────────

export interface ShortLivedTokenResponse {
  access_token: string;
  /** Instagram's numeric user id, returned alongside the token. */
  user_id: number | string;
  permissions?: string;
}

export interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds. Currently 60 days for a long-lived Instagram token. */
  expires_in: number;
}

// ── Graph resources ──────────────────────────────────────────────────────

export interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
  followers_count?: number;
  media_count?: number;
}

export interface InstagramMediaNode {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

export interface GraphListResponse<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

/**
 * Meta's error envelope. `code` and `error_subcode` are what actually drive
 * behaviour — the human-readable `message` changes without notice and must
 * never be branched on.
 */
export interface GraphErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Error codes worth handling specifically.
 *
 * 190 is the whole "token is no longer usable" family; the subcode says why.
 * 4 and 17 are throttling and mean back off rather than retry immediately.
 * 32 and 613 are the page/app-level rate limits.
 */
export const GRAPH_ERROR = {
  INVALID_TOKEN: 190,
  APP_RATE_LIMIT: 4,
  USER_RATE_LIMIT: 17,
  PAGE_RATE_LIMIT: 32,
  CALL_LIMIT: 613,
  PERMISSION_DENIED: 200,
  UNSUPPORTED_REQUEST: 100,
} as const;

/** Subcodes of 190 that specifically mean "the user revoked us". */
export const REVOKED_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);

// ── Webhook payloads ─────────────────────────────────────────────────────

export interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  /** The Instagram account the event belongs to. Used to route to a workspace. */
  id: string;
  time: number;
  changes?: WebhookChange[];
  /** Messaging events arrive under `messaging`, not `changes`. */
  messaging?: MessagingEvent[];
}

export interface WebhookChange {
  field: string;
  value: Record<string, unknown>;
}

export interface CommentChangeValue {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}

export interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
  };
}
