import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../http/errors.js";
import { readSessionCookie, clearSessionCookie } from "../modules/auth/session.cookie.js";
import * as authService from "../modules/auth/auth.service.js";

/**
 * Resolves the session cookie, if any, and attaches `req.auth`.
 *
 * Split from `requireAuth` so routes that behave differently for signed-in
 * users without demanding a session can still see one. `requireAuth` is the
 * gate; this only ever looks.
 */
export const attachSession: RequestHandler = async (req, res, next) => {
  const token = readSessionCookie(req);
  if (!token) {
    next();
    return;
  }

  const session = await authService.resolveSession(token);
  if (!session) {
    // The cookie names a session that no longer exists. Clearing it stops the
    // browser re-sending a dead credential on every subsequent request.
    clearSessionCookie(res);
    next();
    return;
  }

  req.auth = {
    userId: session.user.id,
    sessionId: session.sessionId,
    email: session.user.email,
    name: session.user.name,
  };
  res.locals.activeWorkspaceId = session.activeWorkspaceId;
  next();
};

/** Rejects the request unless `attachSession` found a live session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(AppError.unauthenticated());
    return;
  }
  next();
};

/**
 * Narrowed request for handlers mounted behind `requireAuth`.
 *
 * The cast in `authed` is sound only because the middleware ran first, which
 * is why handlers are never exported for direct mounting — they are always
 * attached to a router that applies the guard.
 */
export interface AuthedRequest extends Request {
  auth: NonNullable<Request["auth"]>;
}

export function authed(req: Request): AuthedRequest {
  if (!req.auth) {
    // Defensive: reaching here means a route was mounted without requireAuth.
    throw AppError.unauthenticated();
  }
  return req as AuthedRequest;
}

/**
 * Wraps a handler so it receives the narrowed request. Express 5 forwards
 * rejected promises to the error handler on its own, so no try/catch is needed
 * here — that was an Express 4 requirement.
 */
export function withAuth(
  handler: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void> | void
): RequestHandler {
  return (req, res, next) => handler(authed(req), res, next);
}
