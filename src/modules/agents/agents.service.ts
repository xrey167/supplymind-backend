import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { eventBus as defaultEventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { agentsRepo as defaultAgentsRepo } from './agents.repo';
import type { AgentsRepository } from './agents.repo';
import { toAgentConfig } from './agents.mapper';
import type { AgentConfig, CreateAgentInput, UpdateAgentInput } from './agents.types';

type EventBus = Pick<typeof defaultEventBus, 'publish'>;

export class AgentsService {
  private repo: AgentsRepository;
  private bus: EventBus;

  constructor(repo?: AgentsRepository, bus?: EventBus) {
    this.repo = repo ?? defaultAgentsRepo;
    this.bus = bus ?? defaultEventBus;
  }

  async list(workspaceId: string): Promise<AgentConfig[]> {
    const rows = await this.repo.findByWorkspace(workspaceId);
    return rows.map(toAgentConfig);
  }

  async getById(id: string): Promise<Result<AgentConfig>> {
    const row = await this.repo.findById(id);
    if (!row) return err(new Error(`Agent not found: ${id}`));
    return ok(toAgentConfig(row));
  }

  async create(input: CreateAgentInput): Promise<Result<AgentConfig>> {
    const row = await this.repo.create(input);
    const agent = toAgentConfig(row);
    this.bus.publish(Topics.AGENT_CREATED, {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      name: agent.name,
    });
    return ok(agent);
  }

  async update(id: string, input: UpdateAgentInput): Promise<Result<AgentConfig>> {
    const row = await this.repo.update(id, input);
    if (!row) return err(new Error(`Agent not found: ${id}`));
    const agent = toAgentConfig(row);
    this.bus.publish(Topics.AGENT_UPDATED, {
      agentId: agent.id,
      changes: Object.keys(input),
    });
    return ok(agent);
  }

  async remove(id: string): Promise<void> {
    await this.repo.remove(id);
  }
}

export const agentsService = new AgentsService();
