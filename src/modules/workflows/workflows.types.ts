export interface WorkflowStep {
  id: string;
  skillId: string;
  args?: Record<string, unknown>;
  message?: string;
  dependsOn?: string[];
  onError?: 'fail' | 'skip' | 'retry';
  maxRetries?: number;
  when?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name?: string;
  description?: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;
}

export interface StepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  durationMs: number;
  retries?: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'partial';
  steps: StepResult[];
  totalDurationMs: number;
}

export type WorkflowDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  text: string,
) => Promise<string>;
