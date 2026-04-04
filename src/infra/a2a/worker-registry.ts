import type { AgentCard, A2AMessage, JsonRpcRequest, JsonRpcResponse } from './types';

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
    this.agents.set(agentUrl, { url: agentUrl, card, apiKey, registeredAt: Date.now() });
    return card;
  }

  async delegate(agentUrl: string, params: { skillId?: string; args?: Record<string, unknown>; message?: A2AMessage }): Promise<unknown> {
    const agent = this.agents.get(agentUrl);
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
    return response.result;
  }

  findBySkill(skillId: string): RegisteredAgent | undefined {
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
  }

  remove(agentUrl: string): void {
    this.agents.delete(agentUrl);
  }
}

export const workerRegistry = new WorkerRegistry();
