export interface InsertUsageRecord {
  workspaceId: string;
  agentId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  missionRunId?: string | null;
  model: string;
  provider: 'anthropic' | 'openai' | 'google';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface RecordUsageInput {
  workspaceId: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  missionRunId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type WorkspaceSummaryRow = {
  model: string;
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};
