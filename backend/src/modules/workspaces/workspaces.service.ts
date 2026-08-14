import type { WorkspaceMember, WorkspaceMembership, WorkspaceRole } from "../../contracts/index.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../http/errors.js";
import * as audit from "../audit/audit.service.js";
import * as sessionRepo from "../auth/auth.repository.js";
import * as repo from "./workspaces.repository.js";

/** Ceiling on workspaces per user. Not a plan limit — a guard against a scripted create loop. */
const MAX_WORKSPACES_PER_USER = 20;

function toMembership(row: {
  workspace: { id: string; name: string; slug: string; ownerId: string; createdAt: Date; updatedAt: Date; _count: { instagramAccounts: number } };
  role: string;
}): WorkspaceMembership {
  return {
    id: row.workspace.id,
    name: row.workspace.name,
    slug: row.workspace.slug,
    ownerId: row.workspace.ownerId,
    createdAt: row.workspace.createdAt.toISOString(),
    updatedAt: row.workspace.updatedAt.toISOString(),
    role: row.role as WorkspaceRole,
    hasConnectedAccount: row.workspace._count.instagramAccounts > 0,
  };
}

export async function listForUser(userId: string): Promise<WorkspaceMembership[]> {
  const rows = await repo.listMembershipsForUser(userId);
  return rows.map(toMembership);
}

export async function create(
  userId: string,
  input: { name: string },
  meta: { ipAddress?: string | null } = {}
): Promise<WorkspaceMembership> {
  const existing = await repo.countWorkspacesForUser(userId);
  if (existing >= MAX_WORKSPACES_PER_USER) {
    throw AppError.conflict(
      `You have reached the limit of ${MAX_WORKSPACES_PER_USER} workspaces.`
    );
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await repo.createWorkspaceWithOwner({ name: input.name, ownerId: userId }, tx);
    await audit.recordInTransaction(
      {
        action: "WORKSPACE_CREATED",
        entityType: "WORKSPACE",
        entityId: created.id,
        workspaceId: created.id,
        userId,
        metadata: { name: created.name },
        ipAddress: meta.ipAddress ?? null,
      },
      tx
    );
    return created;
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerId: workspace.ownerId,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
    role: "OWNER",
    hasConnectedAccount: false,
  };
}

export async function update(
  workspaceId: string,
  userId: string,
  input: { name: string },
  meta: { ipAddress?: string | null } = {}
): Promise<WorkspaceMembership> {
  const updated = await repo.updateWorkspace(workspaceId, { name: input.name });

  void audit.record({
    action: "WORKSPACE_UPDATED",
    entityType: "WORKSPACE",
    entityId: workspaceId,
    workspaceId,
    userId,
    metadata: { name: input.name },
    ipAddress: meta.ipAddress ?? null,
  });

  const membership = await repo.findMembership(workspaceId, userId);

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    ownerId: updated.ownerId,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    role: (membership?.role as WorkspaceRole) ?? "MEMBER",
    hasConnectedAccount:
      (await prisma.instagramAccount.count({ where: { workspaceId, status: "ACTIVE" } })) > 0,
  };
}

/**
 * Switching the active workspace.
 *
 * Membership is re-checked here even though the caller has just listed their
 * workspaces: the list is a snapshot, and the authoritative answer to "may I
 * enter this workspace?" is a fresh lookup. The result is written to the
 * session so the choice survives the cookie being cleared, and so a request
 * arriving without the cookie still lands in the right tenant.
 */
export async function switchTo(
  userId: string,
  sessionId: string,
  workspaceId: string
): Promise<WorkspaceMembership> {
  const membership = await repo.findMembership(workspaceId, userId);
  // Not found rather than forbidden — a workspace the user cannot see must not
  // be distinguishable from one that does not exist.
  if (!membership) throw AppError.notFound("That workspace");

  await sessionRepo.setSessionActiveWorkspace(sessionId, workspaceId);

  const activeAccounts = await prisma.instagramAccount.count({
    where: { workspaceId, status: "ACTIVE" },
  });

  return {
    id: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
    ownerId: membership.workspace.ownerId,
    createdAt: membership.workspace.createdAt.toISOString(),
    updatedAt: membership.workspace.updatedAt.toISOString(),
    role: membership.role,
    hasConnectedAccount: activeAccounts > 0,
  };
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await repo.listMembers(workspaceId);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    name: row.user.name,
    email: row.user.email,
    createdAt: row.createdAt.toISOString(),
  }));
}
