import { db } from '../db/client';
import { a2aTasks, taskDependencies, toolCallLogs } from '../db/schema';
import { and, eq, inArray, lt, desc } from 'drizzle-orm';
import type { A2ATask, TaskState } from './types';

type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled']);

export const taskRepo = {
  async create(data: {
    id: string;
    workspaceId: string;
    agentId: string;
    status: TaskState;
    input: unknown;
    sessionId?: string;
  }) {
    await db.insert(a2aTasks).values({
      id: data.id,
      workspaceId: data.workspaceId,
      agentId: data.agentId,
      status: data.status,
      input: data.input ?? {},
    }).onConflictDoNothing();
  },

  async updateStatus(taskId: string, status: TaskState, output?: unknown, artifacts?: unknown) {
    await db.update(a2aTasks)
      .set({
        status,
        ...(output !== undefined && { output }),
        ...(artifacts !== undefined && { artifacts }),
        updatedAt: new Date(),
      })
      .where(eq(a2aTasks.id, taskId));
  },

  async findByWorkspace(workspaceId: string, opts?: { limit?: number; cursor?: string }): Promise<A2ATask[]> {
    const limit = opts?.limit ?? 100;
    const cursor = opts?.cursor;
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const rows = await db.select().from(a2aTasks)
      .where(
        cursorDate
          ? and(eq(a2aTasks.workspaceId, workspaceId), lt(a2aTasks.createdAt, cursorDate))
          : eq(a2aTasks.workspaceId, workspaceId),
      )
      .orderBy(desc(a2aTasks.createdAt))
      .limit(limit);

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

  async findWorkspaceById(taskId: string): Promise<string | undefined> {
    const rows = await db.select({ workspaceId: a2aTasks.workspaceId }).from(a2aTasks).where(eq(a2aTasks.id, taskId));
    return rows[0]?.workspaceId ?? undefined;
  },

  async findByStatus(status: TaskState): Promise<A2ATask[]> {
    const rows = await db.select().from(a2aTasks).where(eq(a2aTasks.status, status));
    return rows.map(row => ({
      id: row.id,
      status: { state: (row.status ?? 'submitted') as A2ATask['status']['state'] },
      artifacts: (row.artifacts as A2ATask['artifacts']) ?? [],
      history: (row.history as A2ATask['history']) ?? [],
    }));
  },

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    await db.insert(taskDependencies).values({ taskId, dependsOnTaskId });
  },

  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    await db.delete(taskDependencies).where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    );
  },

  async getAllDependencies(): Promise<{ taskId: string; dependsOnTaskId: string }[]> {
    return db.select().from(taskDependencies);
  },

  async getDependencies(taskId: string): Promise<{ blockedBy: string[]; blocks: string[] }> {
    const [blockedByRows, blocksRows] = await Promise.all([
      db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId)),
      db.select().from(taskDependencies).where(eq(taskDependencies.dependsOnTaskId, taskId)),
    ]);
    return {
      blockedBy: blockedByRows.map(r => r.dependsOnTaskId),
      blocks: blocksRows.map(r => r.taskId),
    };
  },

  async getBlockers(taskId: string): Promise<string[]> {
    // Find tasks that taskId depends on (blockedBy)
    const depRows = await db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
    if (depRows.length === 0) return [];

    const depIds = depRows.map(r => r.dependsOnTaskId);
    const taskRows = await db.select({ id: a2aTasks.id, status: a2aTasks.status })
      .from(a2aTasks)
      .where(inArray(a2aTasks.id, depIds));

    return taskRows
      .filter(r => !TERMINAL_STATES.has(r.status ?? ''))
      .map(r => r.id);
  },

  async logToolCall(data: {
    taskId: string;
    skillName: string;
    status: ToolCallStatus;
    input: unknown;
    output?: unknown;
    durationMs?: number;
    error?: string;
  }) {
    await db.insert(toolCallLogs).values({
      taskId: data.taskId,
      skillName: data.skillName,
      status: data.status,
      input: data.input ?? {},
      output: data.output,
      durationMs: data.durationMs,
      error: data.error,
    });
  },
};
