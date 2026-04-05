import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { apiKeys } from '../../infra/db/schema';
import type { ApiKey } from './api-keys.types';

function toApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    role: row.role as ApiKey['role'],
    enabled: row.enabled ?? true,
    keyPrefix: row.keyPrefix,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export const apiKeysRepo = {
  async list(workspaceId: string): Promise<ApiKey[]> {
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId));
    return rows.map(toApiKey);
  },

  async get(id: string, workspaceId: string): Promise<ApiKey | null> {
    const [row] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)));
    return row ? toApiKey(row) : null;
  },

  async revoke(id: string, workspaceId: string): Promise<boolean> {
    const result = await db.update(apiKeys)
      .set({ enabled: false })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
      .returning({ id: apiKeys.id });
    return result.length > 0;
  },

  async deleteKey(id: string, workspaceId: string): Promise<boolean> {
    const result = await db.delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
      .returning({ id: apiKeys.id });
    return result.length > 0;
  },

  async deleteExpired(): Promise<number> {
    const result = await db.delete(apiKeys)
      .where(and(isNotNull(apiKeys.expiresAt), lt(apiKeys.expiresAt, new Date())));
    return result.length;
  },
};
