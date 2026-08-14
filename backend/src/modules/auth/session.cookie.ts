import type { CookieOptions, Request, Response } from "express";
import { env, isProduction } from "../../config/env.js";

/**
 * Session and workspace cookies.
 *
 * The session cookie is httpOnly: the browser sends it, JavaScript cannot read
 * it, and an XSS bug therefore cannot exfiltrate a session. That is the whole
 * reason the API does not hand tokens to the frontend to store.
 */

export const SESSION_COOKIE = "sp_session";

/**
 * The active workspace. Deliberately *not* httpOnly — the frontend reads it to
 * render the right workspace before its first API response arrives, which
 * removes a flash of the wrong tenant. Safe because the value is a claim, not
 * a credential: the server validates it against membership on every request
 * and ignores it when it does not hold up.
 */
export const WORKSPACE_COOKIE = "sp_workspace";

export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400_000;

/**
 * `SameSite=Lax` in both environments.
 *
 * In development the frontend is :3000 and the API is :5000. Those are
 * different *origins* but the same *site* — SameSite compares registrable
 * domains and ignores the port — so Lax sends the cookie normally. `None`
 * would be the alternative and is strictly worse: it requires `Secure`, which
 * rules it out over plain http, and it opts the cookie into cross-site
 * requests that this API never needs.
 *
 * Deploying the two on genuinely different sites would require `None; Secure`
 * plus a CSRF token, which is why the production topology puts both behind one
 * domain.
 */
function baseCookie(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...baseCookie(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  // Must match the attributes used to set it, or the browser keeps the original.
  res.clearCookie(SESSION_COOKIE, { ...baseCookie(), maxAge: undefined });
}

export function readSessionCookie(req: Request): string | null {
  const value = req.cookies?.[SESSION_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function setWorkspaceCookie(res: Response, workspaceId: string): void {
  res.cookie(WORKSPACE_COOKIE, workspaceId, {
    ...baseCookie(),
    httpOnly: false,
    maxAge: SESSION_TTL_MS,
  });
}

export function clearWorkspaceCookie(res: Response): void {
  res.clearCookie(WORKSPACE_COOKIE, { ...baseCookie(), httpOnly: false, maxAge: undefined });
}

export function readWorkspaceCookie(req: Request): string | null {
  const value = req.cookies?.[WORKSPACE_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MS);
}

/** Allowlist check for post-OAuth redirects, to keep the callback from becoming an open redirect. */
export function isAllowedRedirect(target: string): boolean {
  try {
    const url = new URL(target, env.FRONTEND_URL);
    const frontend = new URL(env.FRONTEND_URL);
    return url.origin === frontend.origin;
  } catch {
    return false;
  }
}
