import { nanoid } from 'nanoid';
import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { NotFoundError } from '../../core/errors';
import { taskManager } from '../../infra/a2a/task-manager';
import { taskRepo } from '../../infra/a2a/task-repo';
import { agentsRepo } from '../agents/agents.repo';
import { toAgentConfig } from '../agents/agents.mapper';
import { enqueueAgentRun } from '../../infra/queue/bullmq';
import type { A2AMessage } from '../../infra/a2a/types';
import type { A2ATask } from './tasks.types';
import { db } from '../../infra/db/client';
import { taskDependencies } from '../../infra/db/schema';

export class TasksService {
  async send(
    agentId: string,
    message: string,
    workspaceId: string,
    callerId: string,
    skillId?: string,
    args?: Record<string, unknown>,
    sessionId?: string,
    runMode?: 'foreground' | 'background',
  ): Promise<Result<A2ATask | { taskId: string; jobId: string | undefined; queued: true }>> {
    const agentRow = await agentsRepo.findById(agentId);
    if (!agentRow) return err(new Error(`Agent not found: ${agentId}`));

    const agent = toAgentConfig(agentRow);
    const a2aMessage: A2AMessage = { role: 'user', parts: [{ kind: 'text', text: message }] };

    if (runMode === 'background') {
      const taskId = nanoid();

      // Pre-create task record so GET /tasks/:id works immediately
      await taskRepo.create({
        id: taskId,
        workspaceId,
        agentId,
        status: 'submitted',
        input: a2aMessage,
        sessionId,
      });

      const job = await enqueueAgentRun({
        taskId,
        agentId,
        workspaceId,
        callerId,
        message: a2aMessage,
        sessionId,
      });

      return ok({ taskId, jobId: job.id, queued: true as const });
    }

    // Foreground: existing path
    const task = await taskManager.send({
      skillId,
      args,
      sessionId,
      message: a2aMessage,
      agentConfig: {
        id: agent.id,
        provider: agent.provider,
        mode: agent.mode,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        toolIds: agent.toolIds,
        workspaceId,
      },
      callerId,
    });

    return ok(task);
  }

  get(taskId: string): A2ATask | undefined {
    return taskManager.get(taskId);
  }

  async cancel(taskId: string, workspaceId: string): Promise<Result<A2ATask, NotFoundError>> {
    const ownerWorkspaceId = await taskRepo.findWorkspaceById(taskId);
    if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
      return err(new NotFoundError('Task not found'));
    }
    const task = taskManager.cancel(taskId);
    if (!task) {
      return err(new NotFoundError('Task not found'));
    }
    return ok(task);
  }

  async list(workspaceId: string, opts?: { limit?: number; cursor?: string }): Promise<A2ATask[]> {
    const dbTasks = await taskRepo.findByWorkspace(workspaceId, opts);
    // Merge live in-memory state for running tasks (more accurate status)
    return dbTasks.map(t => taskManager.get(t.id) ?? t);
  }

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<Result<void>> {
    return db.transaction(async (tx) => {
      // Cycle detection: load all edges inside the transaction for a consistent snapshot
      const allEdges = await tx.select().from(taskDependencies);
      const adjList = new Map<string, string[]>();
      for (const edge of allEdges) {
        const deps = adjList.get(edge.taskId) ?? [];
        deps.push(edge.dependsOnTaskId);
        adjList.set(edge.taskId, deps);
      }
      // Also add the proposed edge
      const proposedDeps = adjList.get(taskId) ?? [];
      proposedDeps.push(dependsOnTaskId);
      adjList.set(taskId, proposedDeps);

      // BFS from dependsOnTaskId — if we reach taskId, there's a cycle
      const visited = new Set<string>();
      const queue: string[] = [dependsOnTaskId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === taskId) {
          throw new Error('Adding this dependency would create a cycle');
        }
        if (visited.has(current)) continue;
        visited.add(current);

        for (const dep of adjList.get(current) ?? []) {
          if (!visited.has(dep)) queue.push(dep);
        }
      }

      await tx.insert(taskDependencies).values({ taskId, dependsOnTaskId });
      return ok(undefined);
    });
  }

  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<Result<void>> {
    await taskRepo.removeDependency(taskId, dependsOnTaskId);
    return ok(undefined);
  }

  async getDependencies(taskId: string): Promise<Result<{ blockedBy: string[]; blocks: string[] }>> {
    const deps = await taskRepo.getDependencies(taskId);
    return ok(deps);
  }
}

export const tasksService = new TasksService();
