import { eq, isNull } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { mcpServerConfigs } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';

export type McpServerRow = typeof mcpServerConfigs.$inferSelect;
type NewMcpServer = typeof mcpServerConfigs.$inferInsert;

export type CreateMcpData = Omit<
  McpServerRow,
  'id' | 'createdAt' | 'updatedAt' | 'toolManifestCache' | 'cacheExpiresAt'
>;

export class McpRepo extends BaseRepo<typeof mcpServerConfigs, McpServerRow, NewMcpServer> {
  constructor() { super(mcpServerConfigs); }

  async findByWorkspace(workspaceId: string): Promise<McpServerRow[]> {
    return db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.workspaceId, workspaceId));
  }

  /**
   * findGlobal: returns configs where workspaceId IS NULL.
   * Note: the current schema has workspaceId as notNull, so this will always
   * return an empty array unless the schema is migrated to allow null.
   */
  async findGlobal(): Promise<McpServerRow[]> {
    return db
      .select()
      .from(mcpServerConfigs)
      .where(isNull(mcpServerConfigs.workspaceId));
  }

  async create(data: CreateMcpData): Promise<McpServerRow> {
    const rows = await db
      .insert(mcpServerConfigs)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(id: string, data: Partial<McpServerRow>): Promise<McpServerRow | null> {
    const { id: _id, createdAt: _ca, ...rest } = data as Record<string, unknown>;
    const rows = await db
      .update(mcpServerConfigs)
      .set({ ...(rest as Partial<typeof mcpServerConfigs.$inferInsert>), updatedAt: new Date() })
      .where(eq(mcpServerConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }
}

export const mcpRepo = new McpRepo();
