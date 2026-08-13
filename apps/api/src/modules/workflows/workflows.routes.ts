import { Router } from "express";
import {
  createWorkflowRequestSchema,
  executionStatusSchema,
  idSchema,
  listWorkflowsQuerySchema,
  paginationQuerySchema,
  testWorkflowRequestSchema,
  updateWorkflowRequestSchema,
} from "@socialpilot/contracts";
import { validateBody, validateQuery } from "../../http/validate.js";
import { requireAuth } from "../../middleware/authenticate.js";
import { requireWorkspace, withWorkspace } from "../../middleware/workspace.js";
import * as controller from "./workflows.controller.js";

export const workflowsRouter: Router = Router();

workflowsRouter.use(requireAuth, requireWorkspace);

const executionsQuerySchema = paginationQuerySchema.extend({
  status: executionStatusSchema.optional(),
  workflowId: idSchema.optional(),
});

workflowsRouter.get(
  "/",
  validateQuery(listWorkflowsQuerySchema),
  withWorkspace(controller.list)
);
workflowsRouter.post(
  "/",
  validateBody(createWorkflowRequestSchema),
  withWorkspace(controller.create)
);

// Declared before `/:id` — Express matches in order, and `/executions` would
// otherwise be captured as a workflow id.
workflowsRouter.get(
  "/executions",
  validateQuery(executionsQuerySchema),
  withWorkspace(controller.listAllExecutions)
);
workflowsRouter.get(
  "/executions/:executionId",
  withWorkspace(controller.getExecution)
);

workflowsRouter.get("/:id", withWorkspace(controller.get));
workflowsRouter.patch(
  "/:id",
  validateBody(updateWorkflowRequestSchema),
  withWorkspace(controller.update)
);
workflowsRouter.delete("/:id", withWorkspace(controller.remove));

workflowsRouter.post("/:id/enable", withWorkspace(controller.enable));
workflowsRouter.post("/:id/disable", withWorkspace(controller.disable));
workflowsRouter.post(
  "/:id/test",
  validateBody(testWorkflowRequestSchema),
  withWorkspace(controller.test)
);

workflowsRouter.get(
  "/:id/executions",
  validateQuery(paginationQuerySchema.extend({ status: executionStatusSchema.optional() })),
  withWorkspace(controller.listExecutions)
);
