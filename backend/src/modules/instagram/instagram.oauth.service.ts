import type { InstagramCallbackQuery } from "../../contracts/index.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import { AppError } from "../../http/errors.js";
import { generateOAuthState } from "../../utils/crypto.js";
import { isAllowedRedirect } from "../auth/session.cookie.js";
import * as audit from "../audit/audit.service.js";
import { getProvider } from "./instagram.provider.js";
import { encryptForStorage } from "./instagram.token.service.js";
import * as repo from "./instagram.repository.js";

/**
 * Server-side OAuth.
 *
 * The whole flow runs on the API. The frontend never sees the app secret, never
 * builds the authorize URL, and never handles the authorization code — it asks
 * for a URL and sends the browser there. The secret only ever exists in this
 * process's memory.
 */

/**
 * States are short-lived. The window only has to cover a human completing
 * Instagram's consent screen; ten minutes is generous for that and small
 * enough that a leaked state is useless by the time it could be replayed.
 */
const STATE_TTL_MS = 10 * 60_000;

export async function beginConnect(input: {
  workspaceId: string;
  userId: string;
  returnTo?: string | null;
}): Promise<{ authorizeUrl: string }> {
  // 256 bits from the CSPRNG, stored server-side. A signed cookie would be the
  // alternative, but it breaks when the callback lands in a different browser
  // context — and it cannot detect replay, which a consumable row can.
  const state = generateOAuthState();

  // Validated before it is stored, not after it comes back. An unvalidated
  // returnTo is an open redirect, and this one would be followed by a browser
  // that has just completed an authorization.
  const returnTo = input.returnTo && isAllowedRedirect(input.returnTo) ? input.returnTo : null;

  await repo.createOAuthState({
    state,
    workspaceId: input.workspaceId,
    userId: input.userId,
    returnTo,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  return { authorizeUrl: getProvider().buildAuthorizeUrl({ state }) };
}

export interface CallbackResult {
  /** Absolute URL to send the browser to. Always same-origin with the frontend. */
  redirectTo: string;
}

/**
 * Handles Meta's redirect back.
 *
 * Every parameter here is attacker-reachable — anyone can request this URL with
 * anything — so the order of checks matters. `state` is verified and consumed
 * *before* `code` is used for anything, because exchanging a code supplied by
 * an attacker would attach their Instagram account to the victim's workspace.
 * That is the login-CSRF this parameter exists to prevent.
 */
export async function handleCallback(query: InstagramCallbackQuery): Promise<CallbackResult> {
  // The user pressed Cancel, or Meta refused. Not an error worth a 500.
  if (query.error) {
    logger.info({ reason: query.error_reason }, "instagram authorization declined");
    return { redirectTo: frontendUrl("/instagram", { status: "cancelled" }) };
  }

  if (!query.state) {
    // No state at all means this was not initiated by us.
    return { redirectTo: frontendUrl("/instagram", { status: "error", reason: "invalid_state" }) };
  }

  const pending = await repo.consumeOAuthState(query.state);
  if (!pending) {
    // Unknown, expired, or already used. All three are indistinguishable to the
    // caller on purpose — telling them which would help them probe.
    logger.warn("instagram callback presented an unusable state");
    return { redirectTo: frontendUrl("/instagram", { status: "error", reason: "invalid_state" }) };
  }

  if (!query.code) {
    return { redirectTo: frontendUrl("/instagram", { status: "error", reason: "no_code" }) };
  }

  try {
    const connected = await getProvider().exchangeCode({ code: query.code });

    const existing = await repo.findAccountByInstagramUserId(connected.instagramUserId);
    if (existing && existing.workspaceId !== pending.workspaceId) {
      // The account is claimed by another workspace. Allowing it would make an
      // inbound webhook ambiguous — see the note on the unique constraint in
      // schema.prisma.
      return {
        redirectTo: frontendUrl("/instagram", { status: "error", reason: "already_connected" }),
      };
    }

    const account = await repo.upsertAccount({
      workspaceId: pending.workspaceId,
      instagramUserId: connected.instagramUserId,
      username: connected.username,
      displayName: connected.displayName,
      profilePictureUrl: connected.profilePictureUrl,
      // Encrypted here, on the way in. Plaintext exists only as a local in this
      // function and is never written anywhere.
      accessTokenEncrypted: encryptForStorage(connected.accessToken),
      tokenExpiresAt: connected.expiresAt,
    });

    /*
     * Subscribe the account to webhook fields.
     *
     * App-level webhook config is not enough — Meta only delivers for an
     * account once the app is subscribed on that account. Skipping this
     * produces a connection that looks perfectly healthy and never receives an
     * event, which is close to undiagnosable from the UI.
     *
     * Deliberately not fatal: the account is already stored and usable for
     * everything except inbound events, and failing the whole connection here
     * would send the user back to the start for a problem a retry can fix.
     * The failure is logged, and the Activity page's silence is the symptom.
     */
    try {
      await getProvider().subscribeToWebhooks({ accessToken: connected.accessToken });
    } catch (error) {
      logger.error(
        { err: error, workspaceId: pending.workspaceId, accountId: account.id },
        "connected the account but could not subscribe it to webhooks — no events will arrive until this succeeds"
      );
    }

    void audit.record({
      action: "INSTAGRAM_CONNECTED",
      entityType: "INSTAGRAM_ACCOUNT",
      entityId: account.id,
      workspaceId: pending.workspaceId,
      userId: pending.userId,
      // Username, not the token. The audit redactor would catch it anyway.
      metadata: { username: connected.username },
    });

    logger.info(
      { workspaceId: pending.workspaceId, username: connected.username },
      "instagram account connected"
    );

    return {
      redirectTo: pending.returnTo
        ? absolute(pending.returnTo)
        : frontendUrl("/instagram", { status: "connected" }),
    };
  } catch (error) {
    // The state is already consumed at this point, so a retry needs a fresh
    // authorization — which is correct: the code is single-use and is now spent.
    logger.error({ err: error }, "instagram code exchange failed");
    return { redirectTo: frontendUrl("/instagram", { status: "error", reason: "exchange_failed" }) };
  }
}

export async function disconnect(input: {
  accountId: string;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const account = await repo.findAccountById(input.accountId, input.workspaceId);
  if (!account) throw AppError.notFound("That Instagram account");

  await repo.disconnectAccount(account.id);

  void audit.record({
    action: "INSTAGRAM_DISCONNECTED",
    entityType: "INSTAGRAM_ACCOUNT",
    entityId: account.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    metadata: { username: account.username },
  });
}

function frontendUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, env.FRONTEND_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function absolute(target: string): string {
  return new URL(target, env.FRONTEND_URL).toString();
}
