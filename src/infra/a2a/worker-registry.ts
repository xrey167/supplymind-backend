import type { AgentCard, A2AMessage, JsonRpcRequest, JsonRpcResponse } from './types';
import { capabilityRegistry } from './capability-negotiation';
import { logger } from '../../config/logger';

interface RegisteredAgent {
  url: string;
  card: AgentCard;
  apiKey?: string;
  registeredAt: number;
}

class WorkerRegistry {
  private agents = new Map<string, RegisteredAgent>();

  async discover(agentUrl: string, apiKey?: string): Promise<AgentCard> {
    const res = await fetch(`${agentUrl}/.well-known/agent.json`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: 'manual', // SSRF prevention
    });
    if (!res.ok) throw new Error(`Failed to discover agent at ${agentUrl}: ${res.status}`);
    const card = await res.json() as AgentCard;
    if (!Array.isArray(card.skills)) {
      throw new Error(`Agent at ${agentUrl} returned an invalid card: 'skills' must be an array, got ${typeof card.skills}`);
    }
    this.agents.set(agentUrl, { url: agentUrl, card, apiKey, registeredAt: Date.now() });
    for (const skill of card.skills ?? []) {
      capabilityRegistry.register(skill.id, agentUrl, {
        version: (skill as any).version ?? '1.0.0',
        features: (skill as any).features ?? [],
      });
    }
    return card;
  }

  async delegate(agentUrl: string, params: { skillId?: string; args?: Record<string, unknown>; message?: A2AMessage }): Promise<unknown> {
    const agent = this.agents.get(agentUrl);
    const skillId = params.skillId;
    let succeeded = false;

    if (skillId) capabilityRegistry.recordStart(skillId, agentUrl);
    try {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tasks/send',
        params,
      };
      const res = await fetch(agentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(agent?.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
        },
        body: JSON.stringify(request),
        redirect: 'manual',
      });
      if (!res.ok) throw new Error(`Delegation failed: ${res.status}`);
      const response = await res.json() as JsonRpcResponse;
      if (response.error) throw new Error(response.error.message);
      succeeded = true;
      return response.result;
    } finally {
      if (skillId) {
        if (succeeded) capabilityRegistry.recordSuccess(skillId, agentUrl);
        else capabilityRegistry.recordFailure(skillId, agentUrl);
      }
    }
  }

  findBySkill(skillId: string, opts?: { minVersion?: string; requiredFeatures?: string[] }): RegisteredAgent | undefined {
    // Try capability-aware negotiation first
    const best = capabilityRegistry.negotiate(skillId, opts);
    if (best) return this.agents.get(best.agentUrl);

    // Fallback: no eligible agent via negotiation (all in cooldown or no version match)
    logger.warn({ skillId, opts }, 'Capability negotiation found no eligible agent — falling back to unconstrained scan');
    for (const agent of this.agents.values()) {
      if (agent.card.skills.some(s => s.id === skillId)) return agent;
    }
    return undefined;
  }

  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  load(url: string, card: AgentCard, apiKey?: string, registeredAt?: number): void {
    this.agents.set(url, { url, card, apiKey, registeredAt: registeredAt ?? Date.now() });
    for (const skill of card.skills ?? []) {
      capabilityRegistry.register(skill.id, url, {
        version: (skill as any).version ?? '1.0.0',
        features: (skill as any).features ?? [],
      });
    }
  }

  remove(agentUrl: string): void {
    this.agents.delete(agentUrl);
    capabilityRegistry.deregisterAgent(agentUrl);
  }
}

export const workerRegistry = new WorkerRegistry();
