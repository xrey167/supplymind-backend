import { skillRegistry } from '../../modules/skills/skills.registry';
import type { AgentCard } from './types';

export function buildAgentCard(opts?: {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
}): AgentCard {
  const skills = skillRegistry.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    inputSchema: s.inputSchema,
    tags: [s.providerType],
  }));

  return {
    name: opts?.name ?? 'SupplyMindAI Agent',
    description: opts?.description ?? 'AI-powered multi-tenant agent',
    url: opts?.url ?? Bun.env.A2A_SERVER_URL ?? `http://localhost:${Bun.env.PORT ?? 3001}`,
    version: opts?.version ?? '1.0.0',
    capabilities: {
      streaming: true,
      toolChoice: true,
      strictToolUse: true,
      parallelToolUse: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'data'],
    skills,
  };
}
