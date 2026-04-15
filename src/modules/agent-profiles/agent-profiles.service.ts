import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { NotFoundError } from '../../core/errors';
import { eventBus as defaultEventBus } from '../../events/bus';
import { MissionTopics } from '../../plugins/mission-kernel/topics';
import { agentProfilesRepo as defaultRepo } from './agent-profiles.repo';
import type { AgentProfilesRepository } from './agent-profiles.repo';
import type { AgentProfile, AgentCategory, CreateAgentProfileInput, UpdateAgentProfileInput } from './agent-profiles.types';

type EventBus = Pick<typeof defaultEventBus, 'publish'>;

export class AgentProfilesService {
  private repo: AgentProfilesRepository;
  private bus: EventBus;

  constructor(repo?: AgentProfilesRepository, bus?: EventBus) {
    this.repo = repo ?? defaultRepo;
    this.bus = bus ?? defaultEventBus;
  }

  async create(workspaceId: string, input: CreateAgentProfileInput): Promise<Result<AgentProfile>> {
    const profile = await this.repo.create(workspaceId, input);
    this.bus.publish(MissionTopics.AGENT_PROFILE_CREATED, {
      workspaceId,
      profileId: profile.id,
      category: profile.category,
      createdAt: profile.createdAt.toISOString(),
    }).catch(() => undefined);
    return ok(profile);
  }

  async get(id: string): Promise<Result<AgentProfile>> {
    const profile = await this.repo.findById(id);
    if (!profile) return err(new NotFoundError('Agent profile not found'));
    return ok(profile);
  }

  async list(workspaceId: string, category?: AgentCategory): Promise<AgentProfile[]> {
    return this.repo.findByWorkspace(workspaceId, category);
  }

  async update(id: string, input: UpdateAgentProfileInput): Promise<Result<AgentProfile>> {
    const profile = await this.repo.update(id, input);
    if (!profile) return err(new NotFoundError('Agent profile not found'));
    this.bus.publish(MissionTopics.AGENT_PROFILE_UPDATED, {
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      updatedAt: profile.updatedAt.toISOString(),
    }).catch(() => undefined);
    return ok(profile);
  }

  async remove(id: string): Promise<Result<void>> {
    const profile = await this.repo.findById(id);
    if (!profile) return err(new NotFoundError('Agent profile not found'));
    await this.repo.remove(id);
    this.bus.publish(MissionTopics.AGENT_PROFILE_DELETED, {
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      deletedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(undefined);
  }

  async resolveForCategory(workspaceId: string, category: AgentCategory): Promise<AgentProfile | null> {
    return this.repo.findDefault(workspaceId, category);
  }
}

export const agentProfilesService = new AgentProfilesService();
