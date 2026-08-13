import type { Request, Response } from "express";
import type {
  ChangePasswordRequest,
  LoginRequest,
  SignupRequest,
  UpdateProfileRequest,
} from "@socialpilot/contracts";
import { created, noContent, ok } from "../../http/respond.js";
import { authed, type AuthedRequest } from "../../middleware/authenticate.js";
import * as service from "./auth.service.js";
import {
  clearSessionCookie,
  clearWorkspaceCookie,
  setSessionCookie,
  setWorkspaceCookie,
} from "./session.cookie.js";

/**
 * Controllers translate HTTP to service calls and back. No business rules, no
 * database access — the only thing they know that services do not is how a
 * cookie is set.
 */

function requestMeta(req: Request): service.RequestMeta {
  return {
    userAgent: req.get("user-agent") ?? null,
    // `req.ip` respects the trust-proxy setting configured in app.ts, so this
    // is the real client address behind a load balancer rather than the proxy's.
    ipAddress: req.ip ?? null,
  };
}

export async function signup(req: Request, res: Response): Promise<void> {
  const body = req.body as SignupRequest;
  const result = await service.signup(body, requestMeta(req));

  setSessionCookie(res, result.token);
  setWorkspaceCookie(res, result.activeWorkspaceId);

  created(res, { user: result.user, activeWorkspaceId: result.activeWorkspaceId });
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginRequest;
  const result = await service.login(body, requestMeta(req));

  setSessionCookie(res, result.token);
  setWorkspaceCookie(res, result.activeWorkspaceId);

  ok(res, { user: result.user, activeWorkspaceId: result.activeWorkspaceId });
}

/**
 * Logout clears cookies unconditionally, even when no session was found. The
 * caller's intent is "end my session", and a request arriving with an already
 * dead cookie should still leave the browser clean rather than returning 401.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  if (req.auth) {
    await service.logout(req.auth.sessionId, req.auth.userId, requestMeta(req));
  }
  clearSessionCookie(res);
  clearWorkspaceCookie(res);
  noContent(res);
}

/**
 * The frontend's session probe. Returns 200 with `user: null` rather than 401
 * when signed out: a 401 here is an expected answer, not an error, and making
 * it one means every client logs a console error on the login page.
 */
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    ok(res, { user: null });
    return;
  }
  const user = await service.getProfile(req.auth.userId);
  ok(res, { user });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const { auth } = authed(req);
  const body = req.body as UpdateProfileRequest;
  const user = await service.updateProfile(auth.userId, body.name);
  ok(res, { user });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { auth } = authed(req) as AuthedRequest;
  const body = req.body as ChangePasswordRequest;
  await service.changePassword(auth.userId, auth.sessionId, body);
  noContent(res);
}
