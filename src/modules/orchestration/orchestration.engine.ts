import type { OrchestrationDefinition, OrchestrationStep, StepResult, OrchestrationResult } from './orchestration.types';
import { resolveTemplate, evaluateCondition } from './orchestration.templates';
import * as skillsDispatch from '../skills/skills.dispatch';
import { emitStepCompleted, emitGateWaiting } from './orchestration.events';

const DEFAULT_MAX_CONCURRENCY = 5;
const MAX_RETRIES = 5;

function topologicalReady(step: OrchestrationStep, completed: Set<string>): boolean {
  if (!step.dependsOn || step.dependsOn.length === 0) return true;
  return step.dependsOn.every((dep) => completed.has(dep));
}

async function executeStep(
  step: OrchestrationStep,
  stepResults: Record<string, StepResult>,
  input: Record<string, unknown>,
  workspaceId: string,
  onGate?: (stepId: string, prompt: string) => Promise<boolean>,
): Promise<StepResult> {
  const start = performance.now();

  if (step.when) {
    const shouldRun = evaluateCondition(step.when, stepResults, input);
    if (!shouldRun) {
      return { stepId: step.id, status: 'skipped', durationMs: performance.now() - start };
    }
  }

  const maxRetries = step.onError === 'retry' ? Math.min(step.maxRetries ?? MAX_RETRIES, MAX_RETRIES) : 1;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let result: unknown;

      switch (step.type) {
        case 'skill': {
          const args = step.args
            ? JSON.parse(resolveTemplate(JSON.stringify(step.args), stepResults, input))
            : {};
          const skillResult = await skillsDispatch.dispatchSkill(step.skillId, args, {
            callerId: 'orchestration',
            workspaceId,
            callerRole: 'system',
          });
          if (!skillResult.ok) throw new Error(skillResult.error instanceof Error ? skillResult.error.message : String(skillResult.error));
          result = skillResult.value;
          break;
        }

        case 'gate': {
          const prompt = step.gatePrompt
            ? resolveTemplate(step.gatePrompt, stepResults, input)
            : 'Approval required to continue';
          emitGateWaiting(input._orchestrationId as string ?? '', step.id, prompt);
          if (onGate) {
            const approved = await onGate(step.id, prompt);
            if (!approved) {
              return { stepId: step.id, status: 'failed', error: 'Gate rejected by user', durationMs: performance.now() - start };
            }
          }
          result = { approved: true };
          break;
        }

        case 'agent':
        case 'collaboration':
        case 'decision':
          result = { type: step.type, status: 'executed' };
          break;
      }

      return { stepId: step.id, status: 'completed', result, durationMs: performance.now() - start };
    } catch (error) {
      if (attempt === maxRetries) {
        const msg = error instanceof Error ? error.message : String(error);
        if (step.onError === 'skip') {
          return { stepId: step.id, status: 'skipped', error: msg, durationMs: performance.now() - start };
        }
        return { stepId: step.id, status: 'failed', error: msg, durationMs: performance.now() - start };
      }
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 30_000)));
    }
  }

  return { stepId: step.id, status: 'failed', error: 'Unreachable', durationMs: performance.now() - start };
}

export async function runOrchestration(
  definition: OrchestrationDefinition,
  workspaceId: string,
  input: Record<string, unknown> = {},
  onGate?: (stepId: string, prompt: string) => Promise<boolean>,
): Promise<OrchestrationResult> {
  const start = performance.now();
  const maxConcurrency = definition.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const completed = new Set<string>();
  const stepResults: Record<string, StepResult> = {};
  const pending = new Set(definition.steps.map((s) => s.id));

  while (pending.size > 0) {
    const ready = definition.steps.filter(
      (s) => pending.has(s.id) && topologicalReady(s, completed),
    );

    if (ready.length === 0 && pending.size > 0) {
      return {
        orchestrationId: definition.id ?? '',
        status: 'failed',
        stepResults,
        totalDurationMs: performance.now() - start,
      };
    }

    const batch = ready.slice(0, maxConcurrency);
    const results = await Promise.all(
      batch.map((step) => executeStep(step, stepResults, input, workspaceId, onGate)),
    );

    for (const result of results) {
      stepResults[result.stepId] = result;
      pending.delete(result.stepId);
      emitStepCompleted(input._orchestrationId as string ?? '', result.stepId, result.status);

      if (result.status === 'completed' || result.status === 'skipped') {
        completed.add(result.stepId);
      } else if (result.status === 'failed') {
        const step = definition.steps.find((s) => s.id === result.stepId)!;
        if (step.onError !== 'skip') {
          return {
            orchestrationId: definition.id ?? '',
            status: 'failed',
            stepResults,
            totalDurationMs: performance.now() - start,
          };
        }
        completed.add(result.stepId);
      }
    }
  }

  return {
    orchestrationId: definition.id ?? '',
    status: 'completed',
    stepResults,
    totalDurationMs: performance.now() - start,
  };
}
