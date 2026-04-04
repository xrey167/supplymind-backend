import { db } from '../db/client';
import { a2aTasks, toolCallLogs } from '../db/schema';
import { eq } from 'drizzle-orm';

export const taskRepo = {
  async create(data: {
    id: string;
    workspaceId: string;
    agentId: string;
    status: string;
    input: unknown;
  }) {
    await db.insert(a2aTasks).values({
      id: data.id,
      workspaceId: data.workspaceId,
      agentId: data.agentId,
      status: data.status as any,
      input: data.input ?? {},
    });
  },

  async updateStatus(taskId: string, status: string, output?: unknown, artifacts?: unknown) {
    await db.update(a2aTasks)
      .set({
        status: status as any,
        ...(output !== undefined && { output }),
        ...(artifacts !== undefined && { artifacts }),
        updatedAt: new Date(),
      })
      .where(eq(a2aTasks.id, taskId));
  },

  async logToolCall(data: {
    taskId: string;
    skillName: string;
    status: string;
    input: unknown;
    output?: unknown;
    durationMs?: number;
    error?: string;
  }) {
    await db.insert(toolCallLogs).values({
      taskId: data.taskId,
      skillName: data.skillName,
      status: data.status as any,
      input: data.input ?? {},
      output: data.output,
      durationMs: data.durationMs,
      error: data.error,
    });
  },
};
