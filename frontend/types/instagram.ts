import type { InstagramAccountStatus } from "./enums";

/**
 * Mirrors `backend/src/contracts/instagram.ts`.
 *
 * Note what is absent: there is no `accessToken` field, and there never should
 * be. The backend's `SAFE_ACCOUNT_SELECT` excludes the encrypted token from
 * every read that feeds a response, so adding it here would describe a payload
 * the API does not send.
 */
export interface InstagramAccount {
  id: string;
  workspaceId: string;
  /** Instagram's own id, stable across username changes. */
  instagramUserId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  status: InstagramAccountStatus;
  tokenExpiresAt: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface InstagramConnection {
  account: InstagramAccount | null;
  /**
   * Computed by the backend from the account row's status. The UI branches on
   * this and never derives connectedness from a truthy username — a
   * disconnected or expired row must not render as live.
   */
  isConnected: boolean;
  /** Set when an account exists but is unusable; drives Connect vs Reconnect. */
  reconnectReason: "EXPIRED" | "REVOKED" | "DISCONNECTED" | null;
  /** True when the server is running the development mock provider. */
  isMockProvider: boolean;
}

/**
 * The frontend never builds Meta's authorize URL — only the server can mint and
 * store the CSRF `state` the callback verifies.
 */
export interface InstagramAuthorizeUrl {
  authorizeUrl: string;
}

export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
}
