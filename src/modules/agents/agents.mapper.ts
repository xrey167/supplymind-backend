import type { agentConfigs } from '../../infra/db/schema';
import type { AgentConfig } from './agents.types';

export function toAgentConfig(row: typeof agentConfigs.$inferSelect): AgentConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    provider: row.provider!,
    mode: row.mode!,
    model: row.model,
    systemPrompt: row.systemPrompt ?? undefined,
    temperature: row.temperature ?? 0.7,
    maxTokens: row.maxTokens ?? 4096,
    toolIds: (row.toolIds as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}
