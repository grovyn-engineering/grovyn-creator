import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { metaRequest, MetaApiError } from "./instagram.api.js";
import {
  INSTAGRAM_AUTH_HOST,
  INSTAGRAM_OAUTH_HOST,
  INSTAGRAM_SCOPES,
  type InstagramMediaNode,
  type InstagramProfile,
  type LongLivedTokenResponse,
  type ShortLivedTokenResponse,
} from "./instagram.types.js";

/**
 * The provider boundary.
 *
 * Everything above this line — the workflow engine, the services, the
 * controllers — depends only on `SocialProvider`. That is what keeps Meta out
 * of the engine, makes the engine unit-testable without a network, and means a
 * second platform is a new implementation rather than a new set of branches
 * scattered through the codebase.
 *
 * The interface is intentionally narrow: it exposes what V1 actually does, not
 * everything Instagram can do. A wider interface would be speculative and
 * would have to be implemented twice, including by the mock.
 */
export interface SocialProvider {
  readonly name: string;
  /** True for the development mock. Surfaced in the UI so simulated state is never mistaken for real. */
  readonly isMock: boolean;

  buildAuthorizeUrl(input: { state: string }): string;

  /** Exchanges the authorization code for a durable token plus the account's identity. */
  exchangeCode(input: { code: string }): Promise<ConnectedAccount>;

  /** Extends a long-lived token. Meta's expire after 60 days and are refreshable after 24 hours. */
  refreshToken(input: { accessToken: string }): Promise<{ accessToken: string; expiresAt: Date | null }>;

  getProfile(input: { accessToken: string }): Promise<InstagramProfile>;

  listMedia(input: { accessToken: string; limit?: number }): Promise<InstagramMediaNode[]>;

  replyToComment(input: {
    accessToken: string;
    commentId: string;
    message: string;
  }): Promise<{ id: string }>;

  sendDirectMessage(input: {
    accessToken: string;
    /** Instagram-scoped id of the recipient. */
    recipientId: string;
    message: string;
  }): Promise<{ id: string }>;

  likeComment(input: { accessToken: string; commentId: string }): Promise<void>;

  /**
   * Subscribes the connected account to webhook fields.
   *
   * App-level webhook configuration is not sufficient — Meta only delivers for
   * an account once the app is subscribed *on that account*. Without this call
   * a connection looks entirely healthy and no event ever arrives, which is
   * close to undiagnosable from the UI.
   */
  subscribeToWebhooks(input: { accessToken: string }): Promise<void>;
}

export interface ConnectedAccount {
  instagramUserId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  accessToken: string;
  expiresAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Real provider
// ─────────────────────────────────────────────────────────────────────────

export class InstagramProvider implements SocialProvider {
  readonly name = "instagram";
  readonly isMock = false;

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
      redirectUri: string;
      graphVersion: string;
    }
  ) {}

  buildAuthorizeUrl({ state }: { state: string }): string {
    const url = new URL("/oauth/authorize", INSTAGRAM_AUTH_HOST);
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    // Comma-separated, not space-separated — Instagram differs from the OAuth 2
    // convention here and silently ignores a space-separated list.
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * Code → short-lived token → long-lived token.
   *
   * Both steps happen here rather than storing the short-lived token first,
   * because the short-lived one expires in about an hour and an account that
   * silently dies an hour after connecting is the worst possible failure mode.
   */
  async exchangeCode({ code }: { code: string }): Promise<ConnectedAccount> {
    // maxAttempts 1: an authorization code is single-use, so a retry after a
    // partial success would fail with "code already used" and mask the real error.
    const short = await metaRequest<ShortLivedTokenResponse>("/oauth/access_token", {
      method: "POST",
      host: INSTAGRAM_OAUTH_HOST,
      maxAttempts: 1,
      form: {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code,
      },
    });

    if (!short?.access_token) {
      throw new MetaApiError("BAD_REQUEST", "Meta did not return an access token");
    }

    const long = await metaRequest<LongLivedTokenResponse>("/access_token", {
      params: {
        grant_type: "ig_exchange_token",
        client_secret: this.config.appSecret,
        access_token: short.access_token,
      },
    });

    const accessToken = long?.access_token ?? short.access_token;
    const expiresAt = long?.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null;

    const profile = await this.getProfile({ accessToken });

    return {
      instagramUserId: profile.id,
      username: profile.username,
      displayName: profile.name ?? null,
      profilePictureUrl: profile.profile_picture_url ?? null,
      accessToken,
      expiresAt,
    };
  }

  async refreshToken({ accessToken }: { accessToken: string }) {
    const refreshed = await metaRequest<LongLivedTokenResponse>("/refresh_access_token", {
      params: { grant_type: "ig_refresh_token", access_token: accessToken },
    });
    return {
      accessToken: refreshed.access_token,
      expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
    };
  }

  getProfile({ accessToken }: { accessToken: string }): Promise<InstagramProfile> {
    return metaRequest<InstagramProfile>("/me", {
      params: {
        fields: "id,username,name,profile_picture_url,account_type",
        access_token: accessToken,
      },
    });
  }

  async listMedia({ accessToken, limit = 25 }: { accessToken: string; limit?: number }) {
    const response = await metaRequest<{ data: InstagramMediaNode[] }>("/me/media", {
      params: {
        fields: "id,caption,media_type,permalink,thumbnail_url,timestamp",
        limit,
        access_token: accessToken,
      },
    });
    return response.data ?? [];
  }

  replyToComment({
    accessToken,
    commentId,
    message,
  }: {
    accessToken: string;
    commentId: string;
    message: string;
  }): Promise<{ id: string }> {
    return metaRequest<{ id: string }>(`/${this.config.graphVersion}/${commentId}/replies`, {
      method: "POST",
      form: { message, access_token: accessToken },
    });
  }

  /**
   * Sends a DM through the Instagram messaging endpoint.
   *
   * Subject to Meta's messaging window: outside 24 hours since the person last
   * messaged the account, this is rejected. That rejection arrives as a
   * BAD_REQUEST and is recorded on the action result rather than retried,
   * because waiting will not open the window.
   */
  sendDirectMessage({
    accessToken,
    recipientId,
    message,
  }: {
    accessToken: string;
    recipientId: string;
    message: string;
  }): Promise<{ id: string }> {
    return metaRequest<{ id: string }>(`/${this.config.graphVersion}/me/messages`, {
      method: "POST",
      form: {
        recipient: JSON.stringify({ id: recipientId }),
        message: JSON.stringify({ text: message }),
        access_token: accessToken,
      },
    });
  }

  async likeComment({ accessToken, commentId }: { accessToken: string; commentId: string }) {
    await metaRequest(`/${this.config.graphVersion}/${commentId}`, {
      method: "POST",
      form: { hide: "false", access_token: accessToken },
    });
  }

  async subscribeToWebhooks({ accessToken }: { accessToken: string }) {
    await metaRequest(`/${this.config.graphVersion}/me/subscribed_apps`, {
      method: "POST",
      form: {
        // Must match the fields subscribed at the app level in the App
        // Dashboard; a field subscribed here but not there is not delivered.
        subscribed_fields: "comments,messages,mentions",
        access_token: accessToken,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Development mock
// ─────────────────────────────────────────────────────────────────────────

/**
 * In-memory stand-in for Meta, so the entire product — OAuth, webhooks,
 * workflow execution — can be exercised without Meta credentials, an App
 * Review, or a public HTTPS callback.
 *
 * It is only ever constructed by `getProvider()` below, which refuses to build
 * it in production. That check is the guarantee that fabricated Instagram data
 * cannot reach a real user.
 */
export class MockInstagramProvider implements SocialProvider {
  readonly name = "instagram-mock";
  readonly isMock = true;

  /** Codes handed out by the fake authorize screen, redeemable once. */
  private readonly pendingCodes = new Map<string, { username: string }>();
  private readonly sent: Array<{ kind: string; payload: unknown }> = [];

  buildAuthorizeUrl({ state }: { state: string }): string {
    // Points at the API's own fake consent screen rather than Instagram. That
    // screen posts back to the real callback, so the OAuth code path under test
    // is the same one production uses — only the far end is different.
    const url = new URL("/api/instagram/mock/authorize", env.BACKEND_URL);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** Called by the mock consent screen to mint a redeemable code. */
  issueCode(username: string): string {
    const code = `mock_${randomUUID()}`;
    this.pendingCodes.set(code, { username });
    return code;
  }

  async exchangeCode({ code }: { code: string }): Promise<ConnectedAccount> {
    const pending = this.pendingCodes.get(code);
    if (!pending) {
      // Mirrors the real failure: a code is single-use and short-lived.
      throw new MetaApiError("BAD_REQUEST", "Authorization code is invalid or already used");
    }
    this.pendingCodes.delete(code);

    const username = pending.username;
    // Deterministic id from the username, so reconnecting the same mock
    // account lands on the same row and the unique constraint behaves as it
    // would in production.
    const instagramUserId = `mock_${Buffer.from(username).toString("hex").slice(0, 16)}`;

    logger.warn({ username }, "mock Instagram provider issued a simulated connection");

    return {
      instagramUserId,
      username,
      displayName: username.replace(/[._]/g, " "),
      profilePictureUrl: null,
      accessToken: `mock_token_${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 86_400_000),
    };
  }

  async refreshToken({ accessToken }: { accessToken: string }) {
    return { accessToken, expiresAt: new Date(Date.now() + 60 * 86_400_000) };
  }

  async getProfile(): Promise<InstagramProfile> {
    return { id: "mock", username: "mock_account", account_type: "BUSINESS" };
  }

  async listMedia(): Promise<InstagramMediaNode[]> {
    return [
      {
        id: "mock_post_1",
        caption: "New drop is live",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/mock1",
        timestamp: new Date().toISOString(),
      },
      {
        id: "mock_post_2",
        caption: "Behind the scenes",
        media_type: "VIDEO",
        permalink: "https://instagram.com/p/mock2",
        timestamp: new Date().toISOString(),
      },
    ];
  }

  async replyToComment(input: { commentId: string; message: string }) {
    this.sent.push({ kind: "reply", payload: input });
    logger.info({ commentId: input.commentId }, "[mock] replied to comment");
    return { id: `mock_reply_${randomUUID()}` };
  }

  async sendDirectMessage(input: { recipientId: string; message: string }) {
    this.sent.push({ kind: "dm", payload: input });
    logger.info({ recipientId: input.recipientId }, "[mock] sent direct message");
    return { id: `mock_dm_${randomUUID()}` };
  }

  async likeComment(input: { commentId: string }) {
    this.sent.push({ kind: "like", payload: input });
  }

  async subscribeToWebhooks() {
    logger.info("[mock] subscribed account to webhook fields");
  }

  /** Test helper. Not part of `SocialProvider`. */
  drain(): Array<{ kind: string; payload: unknown }> {
    return this.sent.splice(0, this.sent.length);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────

let cached: SocialProvider | null = null;

/**
 * Chooses the provider once per process.
 *
 * The production guard is duplicated here even though env.ts already refuses
 * to boot with `USE_MOCK_INSTAGRAM` set in production. Two independent checks
 * is the right amount for "must never serve fabricated data to a paying
 * customer" — this one also covers a provider constructed outside the normal
 * startup path, such as in a script.
 */
export function getProvider(): SocialProvider {
  if (cached) return cached;

  if (env.USE_MOCK_INSTAGRAM) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "Refusing to construct the mock Instagram provider in production. Set USE_MOCK_INSTAGRAM=false."
      );
    }
    cached = new MockInstagramProvider();
    return cached;
  }

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    throw new Error("Meta credentials are required when USE_MOCK_INSTAGRAM is false");
  }

  cached = new InstagramProvider({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    redirectUri: env.META_REDIRECT_URI,
    graphVersion: env.META_GRAPH_VERSION,
  });
  return cached;
}

/** Test seam, so a suite can install a stub without going through the environment. */
export function setProvider(provider: SocialProvider | null): void {
  cached = provider;
}
