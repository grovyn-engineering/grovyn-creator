import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";
import { instagramAccountStatusSchema } from "./enums.js";

/**
 * The Instagram account as the client is allowed to see it.
 *
 * This schema is the enforcement point for the rule that the encrypted access
 * token never leaves the server: the account repository's select list is
 * derived from these keys, so adding `accessTokenEncrypted` to a response
 * would require adding it here first, where it is obviously wrong.
 */
export const instagramAccountSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  /** Instagram's own user id for the account. Stable across username changes. */
  instagramUserId: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  status: instagramAccountStatusSchema,
  /** Null when Meta issued a token without a stated expiry. */
  tokenExpiresAt: isoDateSchema.nullable(),
  connectedAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type InstagramAccount = z.infer<typeof instagramAccountSchema>;

/**
 * What the Instagram page renders. `account` is null when nothing is
 * connected — the UI must branch on this rather than on a truthy `username`,
 * so a half-written row can never render as "Connected".
 */
export const instagramConnectionSchema = z.object({
  account: instagramAccountSchema.nullable(),
  /**
   * True only when the backend has an account row in a usable status. The
   * frontend never derives connectedness itself.
   */
  isConnected: z.boolean(),
  /**
   * Set when `isConnected` is false but an account row exists — tells the UI
   * whether to show "Connect" or "Reconnect", and why.
   */
  reconnectReason: z.enum(["EXPIRED", "REVOKED", "DISCONNECTED"]).nullable(),
  /** True when the server is running the development mock provider. */
  isMockProvider: z.boolean(),
});
export type InstagramConnection = z.infer<typeof instagramConnectionSchema>;

/**
 * Returned by `GET /api/instagram/connect`. The frontend does not build the
 * Meta authorize URL — it asks the server for one, because only the server
 * can mint and store the CSRF `state` that the callback will verify.
 */
export const instagramAuthorizeUrlSchema = z.object({
  authorizeUrl: z.string().url(),
});
export type InstagramAuthorizeUrl = z.infer<typeof instagramAuthorizeUrlSchema>;

/**
 * Query parameters Meta appends to the redirect URI. Every field is optional
 * because this is attacker-reachable input: anyone can hit the callback with
 * anything, so the shape is parsed defensively and `state` is verified before
 * `code` is used for anything.
 */
export const instagramCallbackQuerySchema = z.object({
  code: z.string().min(1).max(1024).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
  error_reason: z.string().max(256).optional(),
  error_description: z.string().max(1024).optional(),
});
export type InstagramCallbackQuery = z.infer<typeof instagramCallbackQuerySchema>;

/** Lightweight media reference, used to populate the post picker in conditions. */
export const instagramMediaSchema = z.object({
  id: z.string(),
  caption: z.string().nullable(),
  mediaType: z.string(),
  permalink: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  timestamp: isoDateSchema.nullable(),
});
export type InstagramMedia = z.infer<typeof instagramMediaSchema>;
