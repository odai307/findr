import { and, asc, count, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  connections,
  invites,
  users,
  workspaceMembers,
  workspaces,
  type WorkspaceRole,
} from '../db/schema.js';
import { recordAudit } from '../shared/audit.js';
import { randomToken, sha256 } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { getWorkspaceForUser, listWorkspacesForUser } from './service.js';

/**
 * Role rules:
 * - owner: everything, including deleting the workspace and making other owners.
 * - admin: members, invites, connections, API keys, usage, admin pages; can't touch owners.
 * - member: search, ask, and their own connections.
 * A workspace always keeps at least one owner.
 */

const INVITE_TTL_MS = 7 * 86_400_000;

export async function requireAdmin(db: Db, workspaceId: string, userId: string) {
  const ws = await getWorkspaceForUser(db, workspaceId, userId);
  if (ws.role === 'member') {
    throw new AppError('FORBIDDEN', 'Only workspace owners and admins can do this.');
  }
  return ws;
}

async function ownerCount(db: Db, workspaceId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));
  return row?.n ?? 0;
}

async function memberRole(db: Db, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (!row) throw new AppError('NOT_FOUND', 'Member not found.');
  return row.role;
}

export async function listMembers(db: Db, workspaceId: string, userId: string) {
  await getWorkspaceForUser(db, workspaceId, userId);
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

export async function changeRole(
  db: Db,
  workspaceId: string,
  actorId: string,
  targetId: string,
  role: WorkspaceRole,
) {
  const actor = await requireAdmin(db, workspaceId, actorId);
  const current = await memberRole(db, workspaceId, targetId);
  if (current === role) return;
  if ((current === 'owner' || role === 'owner') && actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only owners can change who is an owner.');
  }
  if (current === 'owner' && (await ownerCount(db, workspaceId)) <= 1) {
    throw new AppError(
      'CONFLICT',
      'A workspace needs at least one owner. Make someone else an owner first.',
    );
  }
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
    );
  await recordAudit(db, {
    action: 'member.role_changed',
    actorUserId: actorId,
    workspaceId,
    targetType: 'user',
    targetId: `${targetId}:${current}->${role}`,
  });
}

/**
 * Removes a member (or lets a member leave). Their personal connections in this workspace and
 * everything indexed from them are deleted, since nobody else may see that content.
 */
export async function removeMember(db: Db, workspaceId: string, actorId: string, targetId: string) {
  const leaving = actorId === targetId;
  const actor = leaving
    ? await getWorkspaceForUser(db, workspaceId, actorId)
    : await requireAdmin(db, workspaceId, actorId);
  const role = await memberRole(db, workspaceId, targetId);
  if (role === 'owner' && !leaving && actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only owners can remove an owner.');
  }
  if (role === 'owner' && (await ownerCount(db, workspaceId)) <= 1) {
    throw new AppError(
      'CONFLICT',
      'A workspace needs at least one owner. Make someone else an owner first.',
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(connections)
      .where(
        and(
          eq(connections.workspaceId, workspaceId),
          eq(connections.ownerUserId, targetId),
          eq(connections.visibility, 'personal'),
        ),
      );
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
  });
  await recordAudit(db, {
    action: leaving ? 'member.left' : 'member.removed',
    actorUserId: actorId,
    workspaceId,
    targetType: 'user',
    targetId,
  });
}

// --- Invites -----------------------------------------------------------------------------------

export async function createInvite(
  db: Db,
  workspaceId: string,
  actorId: string,
  input: { email: string; role: WorkspaceRole },
) {
  const actor = await requireAdmin(db, workspaceId, actorId);
  if (input.role === 'owner' && actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only owners can invite owners.');
  }
  const email = input.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)));
  if (existing) throw new AppError('CONFLICT', 'That person is already a member.');

  const token = randomToken();
  const [invite] = await db.transaction(async (tx) => {
    // A new invite replaces any earlier pending one for the same address.
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.workspaceId, workspaceId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      );
    return tx
      .insert(invites)
      .values({
        workspaceId,
        email,
        role: input.role,
        tokenHash: sha256(token),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
  });
  await recordAudit(db, {
    action: 'invite.created',
    actorUserId: actorId,
    workspaceId,
    targetType: 'invite',
    targetId: invite!.id,
  });
  return { invite: inviteView(invite!), token };
}

function inviteView(i: typeof invites.$inferSelect) {
  return { id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt };
}

export async function listInvites(db: Db, workspaceId: string, actorId: string) {
  await requireAdmin(db, workspaceId, actorId);
  const rows = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.workspaceId, workspaceId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invites.createdAt));
  return rows.map(inviteView);
}

export async function revokeInvite(db: Db, workspaceId: string, actorId: string, inviteId: string) {
  await requireAdmin(db, workspaceId, actorId);
  const [row] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.workspaceId, workspaceId),
        isNull(invites.acceptedAt),
      ),
    )
    .returning({ id: invites.id });
  if (!row) throw new AppError('NOT_FOUND', 'Invite not found.');
  await recordAudit(db, {
    action: 'invite.revoked',
    actorUserId: actorId,
    workspaceId,
    targetType: 'invite',
    targetId: inviteId,
  });
}

async function findUsableInvite(db: Db, token: string) {
  const [row] = await db
    .select({ invite: invites, workspaceName: workspaces.name, inviterName: users.name })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(eq(invites.tokenHash, sha256(token)));
  if (!row || row.invite.revokedAt || row.invite.acceptedAt || row.invite.expiresAt <= new Date()) {
    throw new AppError('NOT_FOUND', 'This invite link is invalid, used or expired.');
  }
  return row;
}

/** What the invite page shows before accepting. Needs only the secret link. */
export async function previewInvite(db: Db, token: string) {
  const row = await findUsableInvite(db, token);
  return {
    workspaceName: row.workspaceName,
    role: row.invite.role,
    email: row.invite.email,
    invitedBy: row.inviterName,
    expiresAt: row.invite.expiresAt,
  };
}

export async function acceptInvite(db: Db, token: string, userId: string) {
  const row = await findUsableInvite(db, token);
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user || user.email !== row.invite.email) {
    throw new AppError(
      'FORBIDDEN',
      `This invite is for ${row.invite.email}. Sign in with that address to accept it.`,
    );
  }
  const workspaceId = row.invite.workspaceId;
  await db.transaction(async (tx) => {
    // Conditional update: two simultaneous accepts can't both succeed.
    const claimed = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invites.id, row.invite.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (!claimed.length) throw new AppError('NOT_FOUND', 'This invite link was already used.');
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: row.invite.role })
      .onConflictDoNothing();
  });
  await recordAudit(db, {
    action: 'invite.accepted',
    actorUserId: userId,
    workspaceId,
    targetType: 'invite',
    targetId: row.invite.id,
  });
  return getWorkspaceForUser(db, workspaceId, userId);
}

/** Owners only. Everything in the workspace is deleted. A user's last workspace is kept. */
export async function deleteWorkspace(db: Db, workspaceId: string, actorId: string) {
  const ws = await getWorkspaceForUser(db, workspaceId, actorId);
  if (ws.role !== 'owner') throw new AppError('FORBIDDEN', 'Only owners can delete a workspace.');
  const mine = await listWorkspacesForUser(db, actorId);
  if (mine.filter((w) => w.id !== workspaceId).length === 0) {
    throw new AppError('CONFLICT', "You can't delete your only workspace.");
  }
  await recordAudit(db, {
    action: 'workspace.deleted',
    actorUserId: actorId,
    targetType: 'workspace',
    targetId: workspaceId,
  });
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

/** Used by the rename route, so renames are audited too. */
export async function auditRename(db: Db, workspaceId: string, actorId: string) {
  await recordAudit(db, { action: 'workspace.renamed', actorUserId: actorId, workspaceId });
}
