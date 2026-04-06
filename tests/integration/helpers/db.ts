import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { workspaces, workspaceMembers, users } from '../../../src/infra/db/schema';
import { sql } from 'drizzle-orm';

const client = postgres(Bun.env.DATABASE_URL!);
export const testDb = drizzle(client);

export interface SeedResult {
  workspaceId: string;
  userId: string;
}

/**
 * Insert a workspace + owner member into the test DB.
 */
export async function seedWorkspace(opts: {
  name?: string;
  userId?: string;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
} = {}): Promise<SeedResult> {
  const userId = opts.userId ?? `user_test_${Math.random().toString(36).slice(2, 10)}`;
  const name = opts.name ?? `Test Workspace ${Date.now()}`;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  await testDb.insert(users).values({ id: userId, email: `${userId}@test.com` }).onConflictDoNothing();

  const [ws] = await testDb.insert(workspaces).values({
    name,
    slug: `${slug}-${Date.now()}`,
    createdBy: userId,
  }).returning({ id: workspaces.id });

  await testDb.insert(workspaceMembers).values({
    workspaceId: ws!.id,
    userId,
    role: opts.role ?? 'owner',
  });

  return { workspaceId: ws!.id, userId };
}

/**
 * Truncate tables (cascade) to clean state between suites.
 */
export async function truncateTables(...tableNames: string[]): Promise<void> {
  if (tableNames.length === 0) return;
  const list = tableNames.map(t => `"${t}"`).join(', ');
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${list} CASCADE`));
}

/** Close the test DB connection */
export async function closeTestDb(): Promise<void> {
  await client.end();
}
