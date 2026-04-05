import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { workerRegistry } from '../../infra/a2a/worker-registry';
import type { AgentCard } from '../../infra/a2a/types';
import { agentRegistryRepo } from './agent-registry.repo';
import type { RegisteredAgent } from './agent-registry.types';

export class AgentRegistryService {
  async register(workspaceId: string, url: string, apiKey?: string): Promise<Result<RegisteredAgent>> {
    try {
      // 1. Discover agent card
      const card = await workerRegistry.discover(url, apiKey);

      // 2. Hash apiKey if provided
      let apiKeyHash: string | undefined;
      if (apiKey) {
        apiKeyHash = await Bun.password.hash(apiKey);
      }

      // 3. Check if already registered for this workspace
      const existing = await agentRegistryRepo.findByWorkspaceAndUrl(workspaceId, url);
      if (existing) {
        const updated = await agentRegistryRepo.updateDiscoveredAt(existing.id, card as unknown as Record<string, unknown>, apiKeyHash);
        const agent = updated ?? existing;
        workerRegistry.load(url, card, apiKey, agent.lastDiscoveredAt?.getTime() ?? agent.createdAt.getTime());
        return ok(agent);
      }

      // 4. Insert new row
      const agent = await agentRegistryRepo.create({
        workspaceId,
        url,
        agentCard: card as unknown as Record<string, unknown>,
        apiKeyHash,
      });

      // 5. Load into in-memory map
      workerRegistry.load(url, card, apiKey, agent.lastDiscoveredAt?.getTime() ?? agent.createdAt.getTime());

      return ok(agent);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async loadAll(): Promise<void> {
    const agents = await agentRegistryRepo.findAll();
    const { logger } = await import('../../config/logger');
    for (const a of agents) {
      if (a.enabled) {
        try {
          const card = a.agentCard as unknown as AgentCard;
          workerRegistry.load(a.url, card, undefined, a.lastDiscoveredAt?.getTime() ?? a.createdAt.getTime());
        } catch (error) {
          logger.error({ agentId: a.id, url: a.url, error }, 'Failed to load registered agent — skipping');
        }
      }
    }
  }

  async list(workspaceId: string): Promise<Result<RegisteredAgent[]>> {
    try {
      const agents = await agentRegistryRepo.findByWorkspace(workspaceId);
      return ok(agents);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async remove(workspaceId: string, id: string): Promise<Result<void>> {
    try {
      const agent = await agentRegistryRepo.findById(id);
      if (!agent) return err(new Error(`Agent not found: ${id}`));
      if (agent.workspaceId !== workspaceId) return err(new Error('Agent not found in this workspace'));

      await agentRegistryRepo.remove(id);
      workerRegistry.remove(agent.url);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async refresh(workspaceId: string, id: string, apiKey?: string): Promise<Result<RegisteredAgent>> {
    try {
      const agent = await agentRegistryRepo.findById(id);
      if (!agent) return err(new Error(`Agent not found: ${id}`));
      if (agent.workspaceId !== workspaceId) return err(new Error('Agent not found in this workspace'));

      const card = await workerRegistry.discover(agent.url, apiKey);
      let apiKeyHash: string | undefined;
      if (apiKey) {
        apiKeyHash = await Bun.password.hash(apiKey);
      }
      const updated = await agentRegistryRepo.updateDiscoveredAt(id, card as unknown as Record<string, unknown>, apiKeyHash);
      const refreshed = updated ?? agent;
      workerRegistry.load(agent.url, card, apiKey, refreshed.lastDiscoveredAt?.getTime() ?? refreshed.createdAt.getTime());
      return ok(refreshed);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export const agentRegistryService = new AgentRegistryService();
