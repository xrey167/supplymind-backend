import { eq, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspacePolicies } from '../../infra/db/schema';
import { getSharedRedisClient } from '../../infra/redis/client';
import { logger } from '../../config/logger';
import type { Policy, PolicyType } from './workspace-policy.types';

const CACHE_TTL_SEC = 60;

function cacheKey(workspaceId: string): string {
  return `policies:${workspaceId}`;
}

function rowToPolicy(row: typeof workspacePolicies.$inferSelect): Policy {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type as PolicyType,
    enabled: row.enabled,
    priority: row.priority,
    conditions: (row.conditions ?? {}) as Policy['conditions'],
    actions: (row.actions ?? {}) as Policy['actions'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function invalidateCache(workspaceId: string): Promise<void> {
  try {
    await getSharedRedisClient().del(cacheKey(workspaceId));
  } catch (err) {
    logger.warn({ err }, 'workspace-policy: failed to invalidate Redis cache');
  }
}

export const workspacePolicyRepo = {
  async listForWorkspace(workspaceId: string): Promise<Policy[]> {
    const redis = getSharedRedisClient();
    try {
      const cached = await redis.get(cacheKey(workspaceId));
      if (cached) return JSON.parse(cached) as Policy[];
    } catch { /* fall through to DB on cache miss */ }

    const rows = await db
      .select()
      .from(workspacePolicies)
      .where(eq(workspacePolicies.workspaceId, workspaceId));

    const policies = rows.map(rowToPolicy);

    try {
      await redis.setex(cacheKey(workspaceId), CACHE_TTL_SEC, JSON.stringify(policies));
    } catch { /* non-fatal */ }

    return policies;
  },

  async getById(id: string, workspaceId: string): Promise<Policy | null> {
    const rows = await db
      .select()
      .from(workspacePolicies)
      .where(
        and(
          eq(workspacePolicies.id, id),
          eq(workspacePolicies.workspaceId, workspaceId),
        ),
      );
    return rows[0] ? rowToPolicy(rows[0]) : null;
  },

  async create(
    workspaceId: string,
    input: Omit<Policy, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>,
  ): Promise<Policy> {
    const [row] = await db
      .insert(workspacePolicies)
      .values({
        workspaceId,
        name: input.name,
        type: input.type,
        enabled: input.enabled,
        priority: input.priority,
        conditions: input.conditions,
        actions: input.actions,
      })
      .returning();
    await invalidateCache(workspaceId);
    return rowToPolicy(row);
  },

  async update(
    id: string,
    workspaceId: string,
    patch: Partial<Omit<Policy, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Policy | null> {
    const [row] = await db
      .update(workspacePolicies)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(workspacePolicies.id, id),
          eq(workspacePolicies.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) return null;
    await invalidateCache(workspaceId);
    return rowToPolicy(row);
  },

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const result = await db
      .delete(workspacePolicies)
      .where(
        and(
          eq(workspacePolicies.id, id),
          eq(workspacePolicies.workspaceId, workspaceId),
        ),
      );
    await invalidateCache(workspaceId);
    return (result.rowCount ?? 0) > 0;
  },
};
