export type CollaborationStrategy = 'fan_out' | 'consensus' | 'debate' | 'map_reduce';
export type MergeStrategy = 'concat' | 'best_score' | 'majority_vote' | 'custom';

export interface CollaborationRequest {
  strategy: CollaborationStrategy;
  query: string;
  agents: string[];
  mergeStrategy?: MergeStrategy;
  maxRounds?: number;
  items?: unknown[];
  timeoutMs?: number;
  judgeAgent?: string;
  convergenceThreshold?: number;
}

export interface AgentResponse {
  agent: string;
  result: string;
  score?: number;
  durationMs: number;
  error?: string;
  round?: number;
}

export interface CollaborationResult {
  id: string;
  strategy: CollaborationStrategy;
  output: string;
  responses: AgentResponse[];
  agreement?: number;
  rounds?: number;
  convergedAt?: number;
  totalDurationMs: number;
  warning?: string;
}

export type CollabDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
) => Promise<string>;

// TODO: Add domain-specific role injection (supply chain roles, etc.)
// Deferred — build general base first.
