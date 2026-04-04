import { db } from '../db/client';
import { a2aTasks, toolCallLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { A2ATask } from './types';

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

  async findByWorkspace(workspaceId?: string): Promise<A2ATask[]> {
    const rows = workspaceId
      ? await db.select().from(a2aTasks).where(eq(a2aTasks.workspaceId, workspaceId))
      : await db.select().from(a2aTasks);
    return rows.map(row => ({
      id: row.id,
      status: { state: (row.status ?? 'submitted') as A2ATask['status']['state'] },
      artifacts: (row.artifacts as A2ATask['artifacts']) ?? [],
      history: (row.history as A2ATask['history']) ?? [],
    }));
  },

  async findById(taskId: string): Promise<A2ATask | undefined> {
    const rows = await db.select().from(a2aTasks).where(eq(a2aTasks.id, taskId));
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      status: { state: (row.status ?? 'submitted') as A2ATask['status']['state'] },
      artifacts: (row.artifacts as A2ATask['artifacts']) ?? [],
      history: (row.history as A2ATask['history']) ?? [],
    };
  },

  async findByStatus(status: string): Promise<A2ATask[]> {
    const rows = await db.select().from(a2aTasks).where(eq(a2aTasks.status, status as any));
    return rows.map(row => ({
      id: row.id,
      status: { state: (row.status ?? 'submitted') as A2ATask['status']['state'] },
      artifacts: (row.artifacts as A2ATask['artifacts']) ?? [],
      history: (row.history as A2ATask['history']) ?? [],
    }));
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
