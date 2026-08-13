import { Router } from "express";
import type { Response } from "express";
import { dashboardQuerySchema, type DashboardQuery } from "@socialpilot/contracts";
import { ok } from "../../http/respond.js";
import { validateQuery, validatedQuery } from "../../http/validate.js";
import { requireAuth } from "../../middleware/authenticate.js";
import { requireWorkspace, withWorkspace, type WorkspaceRequest } from "../../middleware/workspace.js";
import * as service from "./dashboard.service.js";

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth, requireWorkspace, validateQuery(dashboardQuerySchema));

/**
 * The overview payload, assembled in one request.
 *
 * Summary, trend and per-workflow performance travel together because the
 * dashboard renders them as one view — splitting them would mean three
 * round trips and three independent loading states for a single screen.
 * Activity is separate: it is polled more often and is paginated on its own page.
 */
dashboardRouter.get(
  "/",
  withWorkspace(async (req: WorkspaceRequest, res: Response) => {
    const { range } = validatedQuery<DashboardQuery>(req);

    const [summary, trend, workflows] = await Promise.all([
      service.getSummary(req.workspace.id, range),
      service.getTrend(req.workspace.id, range),
      service.getWorkflowPerformance(req.workspace.id, range),
    ]);

    ok(res, { summary, trend: { points: trend }, workflows });
  })
);

dashboardRouter.get(
  "/activity",
  withWorkspace(async (req: WorkspaceRequest, res: Response) => {
    const activity = await service.getActivity(req.workspace.id);
    ok(res, { activity });
  })
);
