import { eq, isNull, or } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { skillDefinitions } from '../../infra/db/schema';
import type { CreateToolInput, UpdateToolInput } from './tools.types';

export class ToolsRepository {
  async findById(id: string) {
    const rows = await db.select().from(skillDefinitions).where(eq(skillDefinitions.id, id));
    return rows[0] ?? null;
  }

  async findByWorkspace(workspaceId?: string) {
    if (workspaceId) {
      return db.select().from(skillDefinitions).where(
        or(eq(skillDefinitions.workspaceId, workspaceId), isNull(skillDefinitions.workspaceId))
      );
    }
    return db.select().from(skillDefinitions).where(isNull(skillDefinitions.workspaceId));
  }

  async create(input: CreateToolInput) {
    const rows = await db.insert(skillDefinitions).values({
      name: input.name,
      description: input.description,
      workspaceId: input.workspaceId ?? null,
      providerType: input.providerType as any,
      priority: input.priority ?? 0,
      inputSchema: input.inputSchema ?? {},
      handlerConfig: input.handlerConfig ?? {},
      enabled: input.enabled ?? true,
    }).returning();
    return rows[0]!;
  }

  async update(id: string, input: UpdateToolInput) {
    const rows = await db.update(skillDefinitions)
      .set({ ...input, providerType: input.providerType as any, updatedAt: new Date() })
      .where(eq(skillDefinitions.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async remove(id: string) {
    await db.delete(skillDefinitions).where(eq(skillDefinitions.id, id));
  }
}

export const toolsRepo = new ToolsRepository();
