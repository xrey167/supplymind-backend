import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { workerRegistry } from '../../engine/a2a/worker-registry';
import type { AgentCard } from '../../engine/a2a/types';
import { agentRegistryRepo } from './agent-registry.repo';
import type { RegisteredAgent } from './agent-registry.types';

export class AgentRegistryService {
  private wReg: typeof workerRegistry;
  private repo: typeof agentRegistryRepo;

  constructor(wReg?: typeof workerRegistry, repo?: typeof agentRegistryRepo) {
    this.wReg = wReg ?? workerRegistry;
    this.repo = repo ?? agentRegistryRepo;
  }

  async register(workspaceId: string, url: string, apiKey?: string): Promise<Result<RegisteredAgent>> {
    try {
      // 1. Discover agent card (best-effort; registration proceeds even if discovery fails)
      let card: import('../../engine/a2a/types').AgentCard;
      try {
        card = await this.wReg.discover(url, apiKey);
      } catch (discoverErr) {
        logger.warn({ url, err: discoverErr }, 'Agent discovery failed during registration — using stub card');
        card = { name: url, description: '', url, version: '0.0.0', capabilities: { streaming: false }, skills: [] };
      }

      // 2. Hash apiKey if provided
      let apiKeyHash: string | undefined;
      if (apiKey) {
        apiKeyHash = await Bun.password.hash(apiKey);
      }

      // 3. Check if already registered for this workspace
      const existing = await this.repo.findByWorkspaceAndUrl(workspaceId, url);
      if (existing) {
        const updated = await this.repo.updateDiscoveredAt(existing.id, card as unknown as Record<string, unknown>, apiKeyHash);
        const agent = updated ?? existing;
        this.wReg.load(url, card, apiKey, agent.lastDiscoveredAt?.getTime() ?? agent.createdAt.getTime());
        return ok(agent);
      }

      // 4. Insert new row
      const agent = await this.repo.registerAgent({
        workspaceId,
        url,
        agentCard: card as unknown as Record<string, unknown>,
        apiKeyHash,
      });

      // 5. Load into in-memory map
      this.wReg.load(url, card, apiKey, agent.lastDiscoveredAt?.getTime() ?? agent.createdAt.getTime());

      return ok(agent);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async loadAll(): Promise<void> {
    const agents = await this.repo.listRegistered();
    const { logger } = await import('../../config/logger');
    for (const a of agents) {
      if (!a.enabled) continue;
      try {
        const card = a.agentCard as unknown as AgentCard;
        this.wReg.load(a.url, card, undefined, a.lastDiscoveredAt?.getTime() ?? a.createdAt.getTime());
      } catch (error) {
        logger.error({ err: error, agentId: a.id, url: a.url }, 'Failed to load registered agent into worker registry — skipping');
      }
    }
  }

  async list(workspaceId: string): Promise<Result<RegisteredAgent[]>> {
    try {
      const agents = await this.repo.findByWorkspace(workspaceId);
      return ok(agents);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async remove(workspaceId: string, id: string): Promise<Result<void>> {
    try {
      const agent = await this.repo.findAgentById(id);
      if (!agent) return err(new Error(`Agent not found: ${id}`));
      if (agent.workspaceId !== workspaceId) return err(new Error('Agent not found in this workspace'));

      await this.repo.remove(id);
      this.wReg.remove(agent.url);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async refresh(workspaceId: string, id: string, apiKey?: string): Promise<Result<RegisteredAgent>> {
    try {
      const agent = await this.repo.findAgentById(id);
      if (!agent) return err(new Error(`Agent not found: ${id}`));
      if (agent.workspaceId !== workspaceId) return err(new Error('Agent not found in this workspace'));

      const card = await this.wReg.discover(agent.url, apiKey);
      let apiKeyHash: string | undefined;
      if (apiKey) {
        apiKeyHash = await Bun.password.hash(apiKey);
      }
      const updated = await this.repo.updateDiscoveredAt(id, card as unknown as Record<string, unknown>, apiKeyHash);
      const refreshed = updated ?? agent;
      this.wReg.load(agent.url, card, apiKey, refreshed.lastDiscoveredAt?.getTime() ?? refreshed.createdAt.getTime());
      return ok(refreshed);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async refreshAll(): Promise<{ refreshed: number; failed: number }> {
    const agents = await this.repo.listRegistered();
    let refreshed = 0;
    let failed = 0;
    for (const agent of agents) {
      const result = await this.refresh(agent.workspaceId, agent.id);
      if (result.ok) {
        refreshed++;
      } else {
        logger.warn({ agentId: agent.id, err: result.error }, 'Agent refresh failed during sync');
        failed++;
      }
    }
    return { refreshed, failed };
  }
}

export const agentRegistryService = new AgentRegistryService();
