import type { Response } from "express";
import type { CreateWorkspaceRequest, SwitchWorkspaceRequest, UpdateWorkspaceRequest } from "@socialpilot/contracts";
import { created, ok } from "../../http/respond.js";
import type { AuthedRequest } from "../../middleware/authenticate.js";
import type { WorkspaceRequest } from "../../middleware/workspace.js";
import { setWorkspaceCookie } from "../auth/session.cookie.js";
import * as service from "./workspaces.service.js";

export async function list(req: AuthedRequest, res: Response): Promise<void> {
  const workspaces = await service.listForUser(req.auth.userId);
  ok(res, { workspaces });
}

export async function create(req: AuthedRequest, res: Response): Promise<void> {
  const body = req.body as CreateWorkspaceRequest;
  const workspace = await service.create(req.auth.userId, body, { ipAddress: req.ip ?? null });

  // A newly created workspace becomes the active one — creating a workspace and
  // then still being in the old one is a surprise every time.
  await service.switchTo(req.auth.userId, req.auth.sessionId, workspace.id);
  setWorkspaceCookie(res, workspace.id);

  created(res, { workspace });
}

/** The workspace the request resolved to. Its presence proves authorization ran. */
export async function current(req: WorkspaceRequest, res: Response): Promise<void> {
  ok(res, { workspace: req.workspace });
}

export async function update(req: WorkspaceRequest, res: Response): Promise<void> {
  const body = req.body as UpdateWorkspaceRequest;
  const workspace = await service.update(req.workspace.id, req.auth.userId, body, {
    ipAddress: req.ip ?? null,
  });
  ok(res, { workspace });
}

export async function switchWorkspace(req: AuthedRequest, res: Response): Promise<void> {
  const body = req.body as SwitchWorkspaceRequest;
  const workspace = await service.switchTo(req.auth.userId, req.auth.sessionId, body.workspaceId);

  setWorkspaceCookie(res, workspace.id);

  ok(res, { workspace });
}

export async function members(req: WorkspaceRequest, res: Response): Promise<void> {
  const list = await service.listMembers(req.workspace.id);
  ok(res, { members: list });
}
