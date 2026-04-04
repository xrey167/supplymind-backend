export type StepType = 'skill' | 'agent' | 'collaboration' | 'gate' | 'decision';
export type OrchestrationStatus = 'submitted' | 'running' | 'paused' | 'completed' | 'failed';
export type ErrorStrategy = 'fail' | 'skip' | 'retry';

interface StepBase {
  id: string;
  dependsOn?: string[];
  onError?: ErrorStrategy;
  maxRetries?: number;
  when?: string;
  label?: string;
  timeout?: number;
}

export interface SkillStep extends StepBase {
  type: 'skill';
  skillId: string;
  args?: Record<string, unknown>;
}

export interface AgentStep extends StepBase {
  type: 'agent';
  agentId: string;
  message?: string;
}

export interface CollaborationStep extends StepBase {
  type: 'collaboration';
  strategy: 'fan_out' | 'consensus' | 'debate' | 'map_reduce';
  agentIds: string[];
  mergeStrategy?: string;
  maxRounds?: number;
}

export interface GateStep extends StepBase {
  type: 'gate';
  gatePrompt?: string;
  signalType?: string;
  autoExecuteThreshold?: number;
}

export interface DecisionStep extends StepBase {
  type: 'decision';
  pipelines?: string[];
}

export type OrchestrationStep = SkillStep | AgentStep | CollaborationStep | GateStep | DecisionStep;

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
