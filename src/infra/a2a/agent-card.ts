import { skillRegistry } from '../../modules/skills/skills.registry';
import type { AgentCard } from './types';

export function buildAgentCard(opts?: { name?: string; description?: string; url?: string; version?: string }): AgentCard {
  const skills = skillRegistry.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

  return {
    name: opts?.name ?? 'SupplyMindAI Agent',
    description: opts?.description ?? 'AI-powered supply chain management agent',
    url: opts?.url ?? process.env.A2A_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
    version: opts?.version ?? '1.0.0',
    capabilities: { streaming: true },
    skills,
  };
}
