import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { agentsRepo } from './agents.repo';
import { toAgentConfig } from './agents.mapper';
import type { AgentConfig, CreateAgentInput, UpdateAgentInput } from './agents.types';

export class AgentsService {
  async list(workspaceId: string): Promise<AgentConfig[]> {
    const rows = await agentsRepo.findByWorkspace(workspaceId);
    return rows.map(toAgentConfig);
  }

  async getById(id: string): Promise<Result<AgentConfig>> {
    const row = await agentsRepo.findById(id);
    if (!row) return err(new Error(`Agent not found: ${id}`));
    return ok(toAgentConfig(row));
  }

  async create(input: CreateAgentInput): Promise<Result<AgentConfig>> {
    const row = await agentsRepo.create(input);
    const agent = toAgentConfig(row);
    eventBus.emit(Topics.AGENT_CREATED, {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      name: agent.name,
    });
    return ok(agent);
  }

  async update(id: string, input: UpdateAgentInput): Promise<Result<AgentConfig>> {
    const row = await agentsRepo.update(id, input);
    if (!row) return err(new Error(`Agent not found: ${id}`));
    const agent = toAgentConfig(row);
    eventBus.emit(Topics.AGENT_UPDATED, {
      agentId: agent.id,
      changes: Object.keys(input),
    });
    return ok(agent);
  }

  async remove(id: string): Promise<void> {
    await agentsRepo.remove(id);
  }
}

export const agentsService = new AgentsService();
