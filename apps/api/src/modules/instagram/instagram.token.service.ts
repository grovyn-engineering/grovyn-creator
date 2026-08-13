import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../http/errors.js";
import { decryptToken, encryptToken } from "../../utils/crypto.js";
import { getProvider } from "./instagram.provider.js";

/**
 * The only module that decrypts an access token.
 *
 * Every other caller asks for a token by account id and gets a plaintext
 * string it uses immediately and does not store. Keeping decryption behind one
 * function is what makes "tokens are encrypted at rest and never logged" a
 * property that can be verified by reading a single file.
 */

/**
 * Refresh when a token has under a week left.
 *
 * Meta's long-lived tokens last 60 days and can be refreshed once they are 24
 * hours old; a token that goes 60 days without a refresh expires permanently.
 * Seven days is comfortably more than any plausible outage, and refreshing
 * eagerly on read means a workspace that is actively receiving events never
 * lets its token lapse.
 */
const REFRESH_THRESHOLD_MS = 7 * 86_400_000;

/**
 * Returns a usable access token, refreshing it first if it is close to expiry.
 *
 * Throws rather than returning null on every failure path. An action executor
 * that received null would have to remember to check, and forgetting would
 * send an empty token to Meta and produce a baffling 400 instead of the
 * actionable "reconnect your account".
 */
export async function getAccessTokenFor(instagramAccountId: string): Promise<string> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: instagramAccountId },
    select: {
      id: true,
      status: true,
      accessTokenEncrypted: true,
      tokenExpiresAt: true,
      username: true,
    },
  });

  if (!account) throw AppError.notFound("That Instagram account");

  if (account.status !== "ACTIVE") {
    throw AppError.accountUnavailable(
      `The Instagram account @${account.username} is not connected. Reconnect it to continue.`
    );
  }

  let token: string;
  try {
    token = decryptToken(account.accessTokenEncrypted);
  } catch (error) {
    // A ciphertext that will not decrypt means the encryption key changed or
    // the row was tampered with. Either way the account is unusable, and
    // marking it EXPIRED gives the user a Reconnect button instead of a
    // repeated failure with no explanation.
    logger.error({ err: error, accountId: account.id }, "failed to decrypt stored access token");
    await markUnusable(account.id, "EXPIRED");
    throw AppError.accountUnavailable(
      "The stored Instagram credentials could not be read. Reconnect the account."
    );
  }

  const expiresAt = account.tokenExpiresAt?.getTime();
  if (expiresAt && expiresAt - Date.now() < REFRESH_THRESHOLD_MS) {
    token = await refresh(account.id, token);
  }

  return token;
}

async function refresh(accountId: string, currentToken: string): Promise<string> {
  try {
    const refreshed = await getProvider().refreshToken({ accessToken: currentToken });

    await prisma.instagramAccount.update({
      where: { id: accountId },
      data: {
        accessTokenEncrypted: encryptToken(refreshed.accessToken),
        tokenExpiresAt: refreshed.expiresAt,
        tokenRefreshedAt: new Date(),
        status: "ACTIVE",
      },
    });

    logger.info({ accountId }, "refreshed Instagram access token");
    return refreshed.accessToken;
  } catch (error) {
    // A refresh failure is not fatal on its own — the current token may still
    // have days left. The work proceeds with it and the next call tries again.
    logger.warn({ err: error, accountId }, "token refresh failed; continuing with current token");
    return currentToken;
  }
}

export async function markUnusable(
  accountId: string,
  status: "EXPIRED" | "REVOKED"
): Promise<void> {
  await prisma.instagramAccount.update({ where: { id: accountId }, data: { status } });
}

/** Stores a freshly issued token. The only other place ciphertext is produced. */
export function encryptForStorage(accessToken: string): string {
  return encryptToken(accessToken);
}
