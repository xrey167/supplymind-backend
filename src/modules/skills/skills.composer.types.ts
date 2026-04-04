export interface PipelineStep {
  skillId: string;
  args?: Record<string, unknown>;
  transform?: string;
  as?: string;
  when?: string;
  onError?: 'abort' | 'skip' | { fallback: unknown };
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  createdAt: string;
}

export interface PipelineStepResult {
  skillId: string;
  alias?: string;
  status: 'completed' | 'skipped' | 'failed' | 'fallback';
  result?: string;
  error?: string;
  durationMs: number;
}

export interface PipelineResult {
  pipelineId: string;
  status: 'completed' | 'failed' | 'partial';
  output: unknown;
  stepResults: PipelineStepResult[];
  totalDurationMs: number;
}

export type PipelineDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  text: string,
) => Promise<string>;
