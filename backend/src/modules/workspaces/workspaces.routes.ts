import { Router } from "express";
import {
  createWorkspaceRequestSchema,
  switchWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
} from "../../contracts/index.js";
import { validateBody } from "../../http/validate.js";
import { requireAuth, withAuth } from "../../middleware/authenticate.js";
import { requireRole, requireWorkspace, withWorkspace } from "../../middleware/workspace.js";
import * as controller from "./workspaces.controller.js";

export const workspacesRouter: Router = Router();

workspacesRouter.use(requireAuth);

// These operate across workspaces, so they take the user's identity only and
// deliberately do not mount `requireWorkspace`.
workspacesRouter.get("/", withAuth(controller.list));
workspacesRouter.post("/", validateBody(createWorkspaceRequestSchema), withAuth(controller.create));
workspacesRouter.post(
  "/switch",
  validateBody(switchWorkspaceRequestSchema),
  withAuth(controller.switchWorkspace)
);

// From here down every route is scoped to one workspace and access-checked.
workspacesRouter.get("/current", requireWorkspace, withWorkspace(controller.current));
workspacesRouter.patch(
  "/current",
  requireWorkspace,
  requireRole("ADMIN"),
  validateBody(updateWorkspaceRequestSchema),
  withWorkspace(controller.update)
);
workspacesRouter.get("/current/members", requireWorkspace, withWorkspace(controller.members));
