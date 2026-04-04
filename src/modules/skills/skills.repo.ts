import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { skillDefinitions } from '../../infra/db/schema';

export class SkillsRepository {
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
}

export const skillsRepo = new SkillsRepository();
