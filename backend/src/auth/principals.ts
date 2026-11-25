import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * The set of principals a user acts as inside one workspace. A document is visible when its
 * access list shares at least one principal with this set.
 *
 * Fix S2: `email:` is added only for an address a provider (Google) verified. Dev-login users
 * get only `user:` and `workspace:`. Group memberships (`group:…`) arrive with Slack in phase 6.
 * Callers must already have checked that the user is a member of the workspace.
 */
export async function principalsFor(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const [user] = await db
    .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const principals = [`user:${userId}`, `workspace:${workspaceId}`];
  if (user?.emailVerifiedAt) principals.push(`email:${user.email}`);
  return principals;
}
