import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { mcpServerConfigs } from '../../infra/db/schema';

export type McpServerRow = typeof mcpServerConfigs.$inferSelect;

export type CreateMcpData = Omit<
  McpServerRow,
  'id' | 'createdAt' | 'updatedAt' | 'toolManifestCache' | 'cacheExpiresAt'
>;

function toRow(row: McpServerRow): McpServerRow {
  return row;
}

export class McpRepo {
  async findByWorkspace(workspaceId: string): Promise<McpServerRow[]> {
    const rows = await db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.workspaceId, workspaceId));
    return rows.map(toRow);
  }

  /**
   * findGlobal: returns configs where workspaceId IS NULL.
   * Note: the current schema has workspaceId as notNull, so this will always
   * return an empty array unless the schema is migrated to allow null.
   */
  async findGlobal(): Promise<McpServerRow[]> {
    const rows = await db
      .select()
      .from(mcpServerConfigs)
      .where(isNull(mcpServerConfigs.workspaceId));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<McpServerRow | undefined> {
    const rows = await db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.id, id));
    return rows[0];
  }

  async create(data: CreateMcpData): Promise<McpServerRow> {
    const rows = await db
      .insert(mcpServerConfigs)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(id: string, data: Partial<McpServerRow>): Promise<McpServerRow | undefined> {
    const { id: _id, createdAt: _ca, ...rest } = data as Record<string, unknown>;
    const rows = await db
      .update(mcpServerConfigs)
      .set({ ...(rest as Partial<typeof mcpServerConfigs.$inferInsert>), updatedAt: new Date() })
      .where(eq(mcpServerConfigs.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string): Promise<void> {
    await db.delete(mcpServerConfigs).where(eq(mcpServerConfigs.id, id));
  }
}

export const mcpRepo = new McpRepo();
