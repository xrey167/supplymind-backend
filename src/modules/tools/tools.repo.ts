import { eq, isNull, or } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { skillDefinitions } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { CreateToolInput, UpdateToolInput } from './tools.types';

type SkillRow = typeof skillDefinitions.$inferSelect;
type NewSkill = typeof skillDefinitions.$inferInsert;

export class ToolsRepository extends BaseRepo<typeof skillDefinitions, SkillRow, NewSkill> {
  constructor() { super(skillDefinitions); }

  async findByWorkspace(workspaceId?: string) {
    if (workspaceId) {
      return db.select().from(skillDefinitions).where(
        or(eq(skillDefinitions.workspaceId, workspaceId), isNull(skillDefinitions.workspaceId))
      );
    }
    return db.select().from(skillDefinitions).where(isNull(skillDefinitions.workspaceId));
  }

  async create(input: CreateToolInput): Promise<SkillRow> {
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

  async update(id: string, input: UpdateToolInput): Promise<SkillRow | null> {
    const rows = await db.update(skillDefinitions)
      .set({ ...input, providerType: input.providerType as any, updatedAt: new Date() })
      .where(eq(skillDefinitions.id, id))
      .returning();
    return rows[0] ?? null;
  }
}

export const toolsRepo = new ToolsRepository();
