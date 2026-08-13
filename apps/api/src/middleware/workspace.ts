import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { WorkspaceRole } from "@socialpilot/contracts";
import { hasRole } from "@socialpilot/contracts";
import { AppError } from "../http/errors.js";
import { readWorkspaceCookie } from "../modules/auth/session.cookie.js";
import * as workspaceRepo from "../modules/workspaces/workspaces.repository.js";
import { authed, type AuthedRequest } from "./authenticate.js";

/**
 * Multi-tenancy enforcement.
 *
 * Every workspace-scoped route mounts `requireWorkspace`, which resolves which
 * workspace the request is for and proves membership before the handler runs.
 * Handlers then read `req.workspace.id` and pass it into repository calls that
 * require it — so the tenant filter is supplied by middleware that has already
 * checked it, never by a client-controlled value that reaches a query directly.
 *
 * Resolution order, most to least explicit:
 *   1. `X-Workspace-Id` header  — what the frontend's API client always sends
 *   2. `?workspaceId=`          — for links and server-side fetches
 *   3. the `sp_workspace` cookie
 *   4. the session's `activeWorkspaceId`
 *   5. the user's first workspace
 *
 * Every one of these is an untrusted claim, including the session's own record.
 * Each is validated against membership before use; a claim that does not hold
 * up falls through to the next rather than failing, so a stale cookie degrades
 * to "your default workspace" instead of an error the user cannot act on.
 */

const WORKSPACE_HEADER = "x-workspace-id";

function claimedWorkspaceId(req: Request): string | null {
  const header = req.get(WORKSPACE_HEADER);
  if (typeof header === "string" && header.length > 0) return header;

  const query = req.query?.workspaceId;
  if (typeof query === "string" && query.length > 0) return query;

  const cookie = readWorkspaceCookie(req);
  if (cookie) return cookie;

  const fromSession = (req.res?.locals as { activeWorkspaceId?: string | null })
    ?.activeWorkspaceId;
  if (typeof fromSession === "string" && fromSession.length > 0) return fromSession;

  return null;
}

export const requireWorkspace: RequestHandler = async (req, _res, next) => {
  const { auth } = authed(req);

  const claimed = claimedWorkspaceId(req);

  if (claimed) {
    const membership = await workspaceRepo.findMembership(claimed, auth.userId);
    if (membership) {
      req.workspace = {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role as WorkspaceRole,
      };
      next();
      return;
    }
    // Falls through deliberately. A claim that does not hold up is treated as
    // absent, not as an attack — the common cause is a cookie left over from a
    // workspace the user has since left.
  }

  const fallback = await workspaceRepo.findFirstMembership(auth.userId);
  if (!fallback) {
    // Signup creates a workspace transactionally, so this only happens if one
    // was deleted out from under the user. It is a real error, not something
    // to paper over by writing a workspace from a read path.
    next(
      new AppError(
        "NOT_FOUND",
        "You do not have a workspace yet. Create one to continue."
      )
    );
    return;
  }

  req.workspace = {
    id: fallback.workspace.id,
    name: fallback.workspace.name,
    slug: fallback.workspace.slug,
    role: fallback.role as WorkspaceRole,
  };
  next();
};

export interface WorkspaceRequest extends AuthedRequest {
  workspace: NonNullable<Request["workspace"]>;
}

export function scoped(req: Request): WorkspaceRequest {
  const withAuthContext = authed(req);
  if (!withAuthContext.workspace) {
    // Reaching here means a route was mounted without requireWorkspace.
    throw AppError.forbidden();
  }
  return withAuthContext as WorkspaceRequest;
}

/** Wraps a handler so it receives a request proven to carry auth and workspace. */
export function withWorkspace(
  handler: (req: WorkspaceRequest, res: Response, next: NextFunction) => Promise<void> | void
): RequestHandler {
  return (req, res, next) => handler(scoped(req), res, next);
}

/**
 * Additional role gate, for routes that need more than membership. V1 assigns
 * only OWNER, so nothing is currently excluded — the check exists so that
 * adding MEMBER collaborators later does not require finding and retrofitting
 * every privileged route.
 */
export function requireRole(minimum: WorkspaceRole): RequestHandler {
  return (req, _res, next) => {
    const { workspace } = scoped(req);
    if (!hasRole(workspace.role, minimum)) {
      next(AppError.forbidden("You do not have permission to do that."));
      return;
    }
    next();
  };
}
