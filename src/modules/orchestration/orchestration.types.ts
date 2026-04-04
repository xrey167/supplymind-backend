export type StepType = 'skill' | 'agent' | 'collaboration' | 'gate' | 'decision';
export type OrchestrationStatus = 'submitted' | 'running' | 'paused' | 'completed' | 'failed';
export type ErrorStrategy = 'fail' | 'skip' | 'retry';

export interface OrchestrationStep {
  id: string;
  type: StepType;
  skillId?: string;
  args?: Record<string, unknown>;
  agentId?: string;
  message?: string;
  strategy?: 'fan_out' | 'consensus' | 'debate' | 'map_reduce';
  agentIds?: string[];
  mergeStrategy?: string;
  maxRounds?: number;
  gatePrompt?: string;
  timeout?: number;
  signalType?: string;
  pipelines?: string[];
  autoExecuteThreshold?: number;
  dependsOn?: string[];
  onError?: ErrorStrategy;
  maxRetries?: number;
  when?: string;
  label?: string;
}

export interface OrchestrationDefinition {
  id?: string;
  name?: string;
  description?: string;
  steps: OrchestrationStep[];
  maxConcurrency?: number;
}

export interface StepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface OrchestrationResult {
  orchestrationId: string;
  status: OrchestrationStatus;
  stepResults: Record<string, StepResult>;
  totalDurationMs: number;
}
