import type { Response } from "express";
import type {
  CreateWorkflowRequest,
  ListWorkflowsQuery,
  PaginationQuery,
  TestWorkflowRequest,
  UpdateWorkflowRequest,
} from "../../contracts/index.js";
import { created, noContent, ok } from "../../http/respond.js";
import { AppError } from "../../http/errors.js";
import { pathParam } from "../../http/params.js";
import { validatedQuery } from "../../http/validate.js";
import type { WorkspaceRequest } from "../../middleware/workspace.js";
import * as executions from "./executions.service.js";
import * as service from "./workflows.service.js";

function requireId(req: WorkspaceRequest): string {
  return pathParam(req, "id");
}

export async function list(req: WorkspaceRequest, res: Response): Promise<void> {
  const query = validatedQuery<ListWorkflowsQuery>(req);
  const workflows = await service.list(req.workspace.id, query ?? {});
  ok(res, { workflows });
}

export async function get(req: WorkspaceRequest, res: Response): Promise<void> {
  const workflow = await service.get(req.workspace.id, requireId(req));
  ok(res, { workflow });
}

export async function create(req: WorkspaceRequest, res: Response): Promise<void> {
  const workflow = await service.create(
    req.workspace.id,
    req.auth.userId,
    req.body as CreateWorkflowRequest
  );
  created(res, { workflow });
}

export async function update(req: WorkspaceRequest, res: Response): Promise<void> {
  const workflow = await service.update(
    req.workspace.id,
    req.auth.userId,
    requireId(req),
    req.body as UpdateWorkflowRequest
  );
  ok(res, { workflow });
}

export async function remove(req: WorkspaceRequest, res: Response): Promise<void> {
  await service.remove(req.workspace.id, req.auth.userId, requireId(req));
  noContent(res);
}

export async function enable(req: WorkspaceRequest, res: Response): Promise<void> {
  const workflow = await service.setEnabled(
    req.workspace.id,
    req.auth.userId,
    requireId(req),
    true
  );
  ok(res, { workflow });
}

export async function disable(req: WorkspaceRequest, res: Response): Promise<void> {
  const workflow = await service.setEnabled(
    req.workspace.id,
    req.auth.userId,
    requireId(req),
    false
  );
  ok(res, { workflow });
}

export async function test(req: WorkspaceRequest, res: Response): Promise<void> {
  const result = await service.test(
    req.workspace.id,
    requireId(req),
    req.body as TestWorkflowRequest
  );
  ok(res, result);
}

export async function listExecutions(req: WorkspaceRequest, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery & { status?: string }>(req);
  const page = await executions.list(req.workspace.id, {
    workflowId: requireId(req),
    ...(query?.status ? { status: query.status } : {}),
    ...(query?.cursor ? { cursor: query.cursor } : {}),
    limit: query?.limit ?? 25,
  });
  ok(res, page);
}

export async function listAllExecutions(req: WorkspaceRequest, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery & { status?: string; workflowId?: string }>(req);
  const page = await executions.list(req.workspace.id, {
    ...(query?.workflowId ? { workflowId: query.workflowId } : {}),
    ...(query?.status ? { status: query.status } : {}),
    ...(query?.cursor ? { cursor: query.cursor } : {}),
    limit: query?.limit ?? 25,
  });
  ok(res, page);
}

export async function getExecution(req: WorkspaceRequest, res: Response): Promise<void> {
  const execution = await executions.get(req.workspace.id, pathParam(req, "executionId"));
  if (!execution) throw AppError.notFound("That execution");

  ok(res, { execution });
}
