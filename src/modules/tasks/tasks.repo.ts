import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { a2aTasks, toolCallLogs } from '../../infra/db/schema';

export class TasksRepository {
  async create(input: {
    id?: string;
    workspaceId: string;
    agentId: string;
    status: string;
    input: unknown;
  }) {
    const rows = await db.insert(a2aTasks).values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      status: input.status as any,
      input: input.input,
    }).returning();
    return rows[0]!;
  }

  async findById(id: string) {
    const rows = await db.select().from(a2aTasks).where(eq(a2aTasks.id, id));
    return rows[0] ?? null;
  }

  async findByWorkspace(workspaceId: string) {
    return db.select().from(a2aTasks).where(eq(a2aTasks.workspaceId, workspaceId));
  }

  async updateStatus(id: string, status: string) {
    const rows = await db.update(a2aTasks)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(a2aTasks.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async logToolCall(
    taskId: string,
    skillName: string,
    status: string,
    input: unknown,
    output?: unknown,
    durationMs?: number,
    error?: string,
  ) {
    const rows = await db.insert(toolCallLogs).values({
      taskId,
      skillName,
      status: status as any,
      input,
      output,
      durationMs,
      error,
    }).returning();
    return rows[0]!;
  }
}

export const tasksRepo = new TasksRepository();
