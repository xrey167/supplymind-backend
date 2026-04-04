import type {
  WorkflowDefinition,
  WorkflowDispatchFn,
  WorkflowResult,
  StepResult,
  WorkflowStep,
} from './workflows.types';
import { resolveTemplate, evaluateWhen } from './workflows.templates';

const DEFAULT_MAX_CONCURRENCY = 5;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function topologicalReady(
  step: WorkflowStep,
  completed: Set<string>,
): boolean {
  if (!step.dependsOn || step.dependsOn.length === 0) return true;
  return step.dependsOn.every((dep) => completed.has(dep));
}

async function executeStep(
  step: WorkflowStep,
  dispatch: WorkflowDispatchFn,
  stepResults: Map<string, StepResult>,
  stepStatuses: Map<string, string>,
  input?: Record<string, unknown>,
): Promise<StepResult> {
  const start = performance.now();

  // Evaluate when condition
  if (step.when !== undefined) {
    const shouldRun = evaluateWhen(step.when, stepResults, stepStatuses, input);
    if (!shouldRun) {
      const dur = performance.now() - start;
      return { stepId: step.id, status: 'skipped', durationMs: dur };
    }
  }

  const maxRetries = step.onError === 'retry'
    ? Math.min(step.maxRetries ?? MAX_RETRIES, MAX_RETRIES)
    : 1;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const text = step.message
        ? resolveTemplate(step.message, stepResults, input, step.skillId)
        : '';
      const args = step.args ? JSON.parse(
        resolveTemplate(JSON.stringify(step.args), stepResults, input, step.skillId),
      ) : {};

      const result = await dispatch(step.skillId, args, text);
      const dur = performance.now() - start;
      return {
        stepId: step.id,
        status: 'completed',
        result,
        durationMs: dur,
        ...(attempt > 1 ? { retries: attempt - 1 } : {}),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
    }
  }

  const dur = performance.now() - start;
  const errorMsg = lastError?.message ?? 'Unknown error';

  if (step.onError === 'skip') {
    return { stepId: step.id, status: 'skipped', error: errorMsg, durationMs: dur };
  }

  return { stepId: step.id, status: 'failed', error: errorMsg, durationMs: dur };
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  dispatch: WorkflowDispatchFn,
  input?: Record<string, unknown>,
): Promise<WorkflowResult> {
  const start = performance.now();
  const maxConcurrency = workflow.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  const stepResults = new Map<string, StepResult>();
  const stepStatuses = new Map<string, string>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const remaining = new Map<string, WorkflowStep>();
  const results: StepResult[] = [];

  for (const step of workflow.steps) {
    remaining.set(step.id, step);
  }

  while (remaining.size > 0) {
    // Find ready steps
    const ready: WorkflowStep[] = [];
    for (const [id, step] of remaining) {
      // If any dependency failed (and wasn't skipped), this step can't run
      const depFailed = step.dependsOn?.some((d) => failed.has(d));
      if (depFailed) {
        remaining.delete(id);
        const sr: StepResult = {
          stepId: id,
          status: 'failed',
          error: 'Dependency failed',
          durationMs: 0,
        };
        results.push(sr);
        stepResults.set(id, sr);
        stepStatuses.set(id, 'failed');
        failed.add(id);
        continue;
      }
      if (topologicalReady(step, completed)) {
        ready.push(step);
      }
    }

    if (ready.length === 0 && remaining.size > 0) {
      // Deadlock — mark remaining as failed
      for (const [id] of remaining) {
        const sr: StepResult = { stepId: id, status: 'failed', error: 'Deadlock', durationMs: 0 };
        results.push(sr);
        failed.add(id);
      }
      remaining.clear();
      break;
    }

    // Execute ready steps with concurrency limit
    const batch = ready.slice(0, maxConcurrency);
    for (const step of batch) {
      remaining.delete(step.id);
    }

    const batchResults = await Promise.all(
      batch.map((step) => executeStep(step, dispatch, stepResults, stepStatuses, input)),
    );

    for (const sr of batchResults) {
      results.push(sr);
      stepResults.set(sr.stepId, sr);
      stepStatuses.set(sr.stepId, sr.status);
      completed.add(sr.stepId);
      if (sr.status === 'failed') {
        failed.add(sr.stepId);
      }
    }
  }

  const totalDurationMs = performance.now() - start;

  const hasFailures = results.some((r) => r.status === 'failed');
  const hasSkips = results.some((r) => r.status === 'skipped');
  const allCompleted = results.every((r) => r.status === 'completed');

  let status: WorkflowResult['status'];
  if (allCompleted) status = 'completed';
  else if (hasFailures && !results.some((r) => r.status === 'completed') && !hasSkips) status = 'failed';
  else if (hasFailures) status = 'failed';
  else status = 'partial';

  // If some skipped but none failed, it's partial
  if (!hasFailures && hasSkips) status = 'partial';

  return { workflowId: workflow.id, status, steps: results, totalDurationMs };
}
