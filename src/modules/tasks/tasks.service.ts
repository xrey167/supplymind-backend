import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { taskManager } from '../../infra/a2a/task-manager';
import { taskRepo } from '../../infra/a2a/task-repo';
import { agentsRepo } from '../agents/agents.repo';
import { toAgentConfig } from '../agents/agents.mapper';
import type { A2ATask } from './tasks.types';

export class TasksService {
  async send(agentId: string, message: string, workspaceId: string, callerId: string, skillId?: string, args?: Record<string, unknown>, sessionId?: string): Promise<Result<A2ATask>> {
    const agentRow = await agentsRepo.findById(agentId);
    if (!agentRow) return err(new Error(`Agent not found: ${agentId}`));

    const agent = toAgentConfig(agentRow);

    const task = await taskManager.send({
      skillId,
      args,
      sessionId,
      message: { role: 'user', parts: [{ kind: 'text', text: message }] },
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

  cancel(taskId: string): A2ATask | undefined {
    return taskManager.cancel(taskId);
  }

  async list(workspaceId?: string): Promise<A2ATask[]> {
    const dbTasks = await taskRepo.findByWorkspace(workspaceId);
    // Merge live in-memory state for running tasks (more accurate status)
    return dbTasks.map(t => taskManager.get(t.id) ?? t);
  }

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<Result<void>> {
    // Cycle detection via BFS: walk all transitive blockers of dependsOnTaskId.
    // If taskId appears, adding this edge would create a cycle.
    const visited = new Set<string>();
    const queue: string[] = [dependsOnTaskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) {
        return err(new Error('Adding this dependency would create a cycle'));
      }
      if (visited.has(current)) continue;
      visited.add(current);

      const { blockedBy } = await taskRepo.getDependencies(current);
      for (const dep of blockedBy) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }

    await taskRepo.addDependency(taskId, dependsOnTaskId);
    return ok(undefined);
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
