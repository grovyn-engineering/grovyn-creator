import type { InstagramAccount, InstagramConnection, InstagramMedia } from "../../contracts/index.js";
import { logger } from "../../config/logger.js";
import { getProvider } from "./instagram.provider.js";
import { getAccessTokenFor } from "./instagram.token.service.js";
import * as repo from "./instagram.repository.js";
import type { SafeInstagramAccount } from "./instagram.repository.js";

function toDto(account: SafeInstagramAccount): InstagramAccount {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    instagramUserId: account.instagramUserId,
    username: account.username,
    displayName: account.displayName,
    profilePictureUrl: account.profilePictureUrl,
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    connectedAt: account.connectedAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * The connection state the UI renders.
 *
 * `isConnected` is computed here, from the row's status, and is the only thing
 * the frontend is allowed to branch on. The requirement is that "Connected"
 * never appears unless the backend says so — deriving it in React from a
 * truthy username would show a half-written or disconnected row as live.
 */
export async function getConnection(workspaceId: string): Promise<InstagramConnection> {
  const account = await repo.findAccountForWorkspace(workspaceId);
  const provider = getProvider();

  if (!account) {
    return {
      account: null,
      isConnected: false,
      reconnectReason: null,
      isMockProvider: provider.isMock,
    };
  }

  const isConnected = account.status === "ACTIVE";

  return {
    account: toDto(account),
    isConnected,
    // Tells the UI whether to say "Connect" or "Reconnect", and why.
    reconnectReason: isConnected
      ? null
      : (account.status as "EXPIRED" | "REVOKED" | "DISCONNECTED"),
    isMockProvider: provider.isMock,
  };
}

/**
 * Recent media, used to populate the post picker when building a condition on
 * `comment.post_id`.
 *
 * A provider failure returns an empty list rather than throwing: the picker is
 * a convenience, and failing the whole workflow builder because Instagram is
 * briefly unreachable would be a poor trade. The user can still type an id.
 */
export async function listMedia(workspaceId: string): Promise<InstagramMedia[]> {
  const account = await repo.findAccountForWorkspace(workspaceId);
  if (!account || account.status !== "ACTIVE") return [];

  try {
    const accessToken = await getAccessTokenFor(account.id);
    const media = await getProvider().listMedia({ accessToken, limit: 25 });

    return media.map((item) => ({
      id: item.id,
      caption: item.caption ?? null,
      mediaType: item.media_type,
      permalink: item.permalink ?? null,
      thumbnailUrl: item.thumbnail_url ?? null,
      timestamp: item.timestamp ?? null,
    }));
  } catch (error) {
    logger.warn({ err: error, workspaceId }, "could not list Instagram media");
    return [];
  }
}
