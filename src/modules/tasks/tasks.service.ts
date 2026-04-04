import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { taskManager } from '../../infra/a2a/task-manager';
import { taskRepo } from '../../infra/a2a/task-repo';
import { agentsRepo } from '../agents/agents.repo';
import { toAgentConfig } from '../agents/agents.mapper';
import { tasksRepo } from './tasks.repo';
import type { A2ATask } from './tasks.types';

export class TasksService {
  async send(agentId: string, message: string, workspaceId: string, callerId: string, skillId?: string, args?: Record<string, unknown>): Promise<Result<A2ATask>> {
    const agentRow = await agentsRepo.findById(agentId);
    if (!agentRow) return err(new Error(`Agent not found: ${agentId}`));

    const agent = toAgentConfig(agentRow);

    // Persist task to DB
    const dbTask = await tasksRepo.create({
      workspaceId,
      agentId,
      status: 'submitted',
      input: { message, skillId, args },
    });

    const task = await taskManager.send({
      id: dbTask.id,
      skillId,
      args,
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
}

export const tasksService = new TasksService();
