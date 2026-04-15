import { db } from '../../infra/db/client';
import { workflowTemplates } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';
import { BaseRepo } from '../../infra/db/repositories/base.repo';

type Row = typeof workflowTemplates.$inferSelect;
type NewRow = typeof workflowTemplates.$inferInsert;

class WorkflowsRepository extends BaseRepo<typeof workflowTemplates, Row, NewRow> {
  constructor() { super(workflowTemplates); }

  async create(data: { workspaceId: string; name: string; description?: string; definition: unknown; createdBy: string }) {
    const [row] = await db.insert(workflowTemplates).values({
      workspaceId: data.workspaceId,
      name: data.name,
      description: data.description,
      definition: data.definition,
      createdBy: data.createdBy,
    }).returning();
    if (!row) throw new Error('Workflow template insert returned no rows');
    return row;
  }

  async list(workspaceId: string) {
    return db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.workspaceId, workspaceId))
      .orderBy(desc(workflowTemplates.createdAt));
  }

  async getById(id: string) {
    const [row] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
      .limit(1);
    return row;
  }

  async update(id: string, patch: { name?: string; description?: string; definition?: unknown }) {
    const [row] = await db.update(workflowTemplates)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, id))
      .returning();
    if (!row) throw new Error('Workflow template update returned no rows — record may not exist');
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
      .returning({ id: workflowTemplates.id });
    return result.length > 0;
  }
}

export const workflowsRepo = new WorkflowsRepository();
