import type { AgentMode, AIProvider } from '../../infra/ai/types';

export interface AgentConfig {
  id: string;
  workspaceId: string;
  name: string;
  provider: AIProvider;
  mode: AgentMode;
  model: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  thinkingBudget?: number;
  toolIds: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  provider: AIProvider;
  mode: AgentMode;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  toolIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentInput {
  name?: string;
  provider?: AIProvider;
  mode?: AgentMode;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  toolIds?: string[];
  metadata?: Record<string, unknown>;
}
