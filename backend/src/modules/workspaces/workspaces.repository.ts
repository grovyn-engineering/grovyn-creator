import type { Prisma, Workspace, WorkspaceMember } from "@prisma/client";
import type { WorkspaceRole } from "../../contracts/index.js";
import type { Db } from "../../config/prisma.js";
import { prisma } from "../../config/prisma.js";
import { slugify, uniquifySlug } from "../../utils/slug.js";

export function findWorkspaceById(id: string, db: Db = prisma): Promise<Workspace | null> {
  return db.workspace.findUnique({ where: { id } });
}

/**
 * The authorization primitive.
 *
 * Every workspace-scoped request resolves through this: it returns a row only
 * when the user is a member, so "can this user touch this workspace?" is a
 * uniqueness lookup rather than a policy evaluated in several places. A `null`
 * here is the whole access check.
 */
export function findMembership(
  workspaceId: string,
  userId: string,
  db: Db = prisma
): Promise<(WorkspaceMember & { workspace: Workspace }) | null> {
  return db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: true },
  });
}

/**
 * Every workspace the user belongs to, with a connected-account flag for the
 * switcher. `_count` on a filtered relation keeps this one query instead of
 * one per workspace.
 */
export function listMembershipsForUser(userId: string, db: Db = prisma) {
  return db.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: {
        include: {
          _count: { select: { instagramAccounts: { where: { status: "ACTIVE" } } } },
        },
      },
    },
    orderBy: { workspace: { createdAt: "asc" } },
  });
}

/** The user's oldest workspace — the fallback when no cookie names a valid one. */
export function findFirstMembership(userId: string, db: Db = prisma) {
  return db.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Creates a workspace and its owner membership as one unit.
 *
 * Takes a `Db` rather than opening its own transaction so signup can create
 * the user, the workspace, and the membership in a single atomic step — a
 * committed user with no workspace is a state the product has no screen for.
 *
 * Slug collisions are resolved by retry rather than by pre-checking: a check
 * would race with a concurrent create, and the unique constraint is the only
 * thing that actually decides.
 */
export async function createWorkspaceWithOwner(
  input: { name: string; ownerId: string; role?: WorkspaceRole },
  db: Db = prisma
): Promise<Workspace> {
  const base = slugify(input.name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : uniquifySlug(base);
    try {
      return await db.workspace.create({
        data: {
          name: input.name,
          slug,
          ownerId: input.ownerId,
          members: { create: { userId: input.ownerId, role: input.role ?? "OWNER" } },
        },
      });
    } catch (error) {
      if (isSlugCollision(error) && attempt < 4) continue;
      throw error;
    }
  }

  // Unreachable: the loop either returns or rethrows.
  throw new Error("Exhausted slug attempts");
}

function isSlugCollision(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.includes("slug") : target === "slug";
}

export function updateWorkspace(
  id: string,
  data: { name?: string },
  db: Db = prisma
): Promise<Workspace> {
  return db.workspace.update({ where: { id }, data });
}

export function listMembers(workspaceId: string, db: Db = prisma) {
  return db.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export function countWorkspacesForUser(userId: string, db: Db = prisma): Promise<number> {
  return db.workspaceMember.count({ where: { userId } });
}

export type MembershipWithWorkspace = Prisma.WorkspaceMemberGetPayload<{
  include: { workspace: true };
}>;
