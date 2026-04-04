import { nanoid } from 'nanoid';
import type {
  Pipeline,
  PipelineStep,
  PipelineResult,
  PipelineStepResult,
  PipelineDispatchFn,
} from './skills.composer.types';

export function compose(
  name: string,
  steps: PipelineStep[],
  description?: string,
): Pipeline {
  return {
    id: nanoid(),
    name,
    description,
    steps,
    createdAt: new Date().toISOString(),
  };
}

export async function executePipeline(
  pipeline: Pipeline,
  input: Record<string, unknown>,
  dispatch: PipelineDispatchFn,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const stepResults: PipelineStepResult[] = [];
  const stepOutputs = new Map<string, string>();
  let prevResult = '';
  let aborted = false;
  let hasSkip = false;

  for (const step of pipeline.steps) {
    if (aborted) break;
    const start = Date.now();

    const text = step.transform
      ? resolveTemplates(step.transform, prevResult, stepOutputs, input)
      : '';
    const args = step.args
      ? JSON.parse(
          resolveTemplates(
            JSON.stringify(step.args),
            prevResult,
            stepOutputs,
            input,
          ),
        )
      : {};

    try {
      const result = await dispatch(step.skillId, args, text);
      prevResult = result;
      if (step.as) stepOutputs.set(step.as, result);
      stepResults.push({
        skillId: step.skillId,
        alias: step.as,
        status: 'completed',
        result,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const onError = step.onError ?? 'abort';

      if (onError === 'abort') {
        stepResults.push({
          skillId: step.skillId,
          alias: step.as,
          status: 'failed',
          error,
          durationMs: Date.now() - start,
        });
        aborted = true;
      } else if (onError === 'skip') {
        hasSkip = true;
        stepResults.push({
          skillId: step.skillId,
          alias: step.as,
          status: 'skipped',
          error,
          durationMs: Date.now() - start,
        });
      } else if (typeof onError === 'object' && 'fallback' in onError) {
        const fallback = String(onError.fallback);
        prevResult = fallback;
        if (step.as) stepOutputs.set(step.as, fallback);
        stepResults.push({
          skillId: step.skillId,
          alias: step.as,
          status: 'fallback',
          result: fallback,
          durationMs: Date.now() - start,
        });
      }
    }
  }

  const status = aborted ? 'failed' : hasSkip ? 'partial' : 'completed';
  return {
    pipelineId: pipeline.id,
    status,
    output: prevResult,
    stepResults,
    totalDurationMs: Date.now() - startTime,
  };
}

function resolveTemplates(
  text: string,
  prevResult: string,
  stepOutputs: Map<string, string>,
  input: Record<string, unknown>,
): string {
  return text
    .replace(/\{\{prev\.result\}\}/g, prevResult)
    .replace(
      /\{\{steps\.(\w+)\.result\}\}/g,
      (_m, alias) => stepOutputs.get(alias) ?? '',
    )
    .replace(/\{\{input\.(\w+)\}\}/g, (_m, key) =>
      input[key] != null ? String(input[key]) : '',
    );
}
