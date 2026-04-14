import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { skillDefinitions } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';

type SkillSelect = typeof skillDefinitions.$inferSelect;
type SkillInsert = typeof skillDefinitions.$inferInsert;

/**
 * SkillsRepository — extends BaseRepo for common CRUD and adds skill-specific
 * lookup methods.
 *
 * Inherited from BaseRepo:
 *   findById(id)   — find a skill by primary key
 *   findAll(filters) — list all (optionally filtered) skills
 *   create(data)   — insert and return a new skill definition
 *   update(id, data) — partial-update a skill definition
 *   remove(id)     — delete a skill definition by id
 */
export class SkillsRepository extends BaseRepo<typeof skillDefinitions, SkillSelect, SkillInsert> {
  constructor() {
    super(skillDefinitions);
  }

  async findByWorkspace(workspaceId: string) {
    return db.select().from(skillDefinitions).where(eq(skillDefinitions.workspaceId, workspaceId));
  }

  async findGlobal() {
    return db.select().from(skillDefinitions).where(isNull(skillDefinitions.workspaceId));
  }

  async findByName(name: string, workspaceId?: string) {
    if (workspaceId) {
      const rows = await db.select().from(skillDefinitions).where(
        and(eq(skillDefinitions.name, name), eq(skillDefinitions.workspaceId, workspaceId))
      );
      if (rows[0]) return rows[0];
    }
    const rows = await db.select().from(skillDefinitions).where(
      and(eq(skillDefinitions.name, name), isNull(skillDefinitions.workspaceId))
    );
    return rows[0] ?? null;
  }

  async getMcpConfig(skillId: string): Promise<Record<string, unknown> | null> {
    const rows = await db
      .select({ mcpConfig: skillDefinitions.mcpConfig })
      .from(skillDefinitions)
      .where(eq(skillDefinitions.id, skillId))
      .limit(1);
    const val = rows[0]?.mcpConfig;
    return (val && typeof val === 'object' && !Array.isArray(val))
      ? (val as Record<string, unknown>)
      : null;
  }

  async setMcpConfig(skillId: string, config: Record<string, unknown>): Promise<void> {
    await db
      .update(skillDefinitions)
      .set({ mcpConfig: config, updatedAt: new Date() })
      .where(eq(skillDefinitions.id, skillId));
  }
}

export const skillsRepo = new SkillsRepository();
