import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { workspaceMembers, workspaces, type WorkspaceRole } from '../db/schema.js';
import { randomToken } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: WorkspaceRole;
  createdAt: Date;
}

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // A random suffix keeps slugs unique without a retry loop.
  return `${base || 'workspace'}-${randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, 'x')}`;
}

export async function createWorkspace(
  db: Db,
  ownerId: string,
  name: string,
): Promise<WorkspaceView> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name, slug: slugify(name), ownerId })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: ownerId, role: 'owner' });
  return {
    id: ws!.id,
    name: ws!.name,
    slug: ws!.slug,
    plan: ws!.plan,
    role: 'owner',
    createdAt: ws!.createdAt,
  };
}

const view = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  plan: workspaces.plan,
  role: workspaceMembers.role,
  createdAt: workspaces.createdAt,
};

export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceView[]> {
  return db
    .select(view)
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

/**
 * Returns the workspace only if the user is a member. A non-member gets NOT_FOUND rather than
 * FORBIDDEN, so the API doesn't reveal which workspace IDs exist.
 */
export async function getWorkspaceForUser(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceView> {
  const [row] = await db
    .select(view)
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return row;
}

export async function renameWorkspace(
  db: Db,
  workspaceId: string,
  userId: string,
  name: string,
): Promise<WorkspaceView> {
  const current = await getWorkspaceForUser(db, workspaceId, userId);
  if (current.role === 'member') {
    throw new AppError('FORBIDDEN', 'Only owners and admins can change workspace settings.');
  }
  await db.update(workspaces).set({ name }).where(eq(workspaces.id, workspaceId));
  return { ...current, name };
}
