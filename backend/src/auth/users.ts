import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, users, type User } from '../db/schema.js';
import { createWorkspace } from '../workspaces/service.js';
import type { GoogleProfile } from './google.js';

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'My';
}

async function createUserWithWorkspace(db: Db, values: typeof users.$inferInsert): Promise<User> {
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values(values).returning();
    await createWorkspace(tx as unknown as Db, user!.id, `${firstName(user!.name)}'s workspace`);
    return user!;
  });
}

/**
 * Finds or creates the user for a Google sign-in. A new user gets a personal workspace.
 * An existing account with the same email is linked to this Google account.
 */
export async function upsertGoogleUser(db: Db, profile: GoogleProfile): Promise<User> {
  const [bySub] = await db.select().from(users).where(eq(users.googleSub, profile.sub)).limit(1);
  const [byEmail] = bySub
    ? [bySub]
    : await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
  const existing = bySub ?? byEmail;

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated!;
  }

  return createUserWithWorkspace(db, {
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
    googleSub: profile.sub,
    emailVerifiedAt: new Date(),
  });
}

/** Local-development sign-in. The email is NOT verified, so it will never unlock email: principals. */
export async function upsertDevUser(db: Db, email: string, name?: string): Promise<User> {
  const normalized = email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (existing) return existing;
  return createUserWithWorkspace(db, {
    email: normalized,
    name: name ?? normalized.split('@')[0]!,
  });
}

export async function recordAudit(
  db: Db,
  entry: {
    action: string;
    actorUserId: string | null;
    ip?: string;
    userAgent?: string;
    workspaceId?: string;
  },
) {
  await db.insert(auditLog).values({
    action: entry.action,
    actorUserId: entry.actorUserId,
    workspaceId: entry.workspaceId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
