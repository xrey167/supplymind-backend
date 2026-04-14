import type { OrchestrationDefinition, OrchestrationStep, StepResult, OrchestrationResult, AgentStep, CollaborationStep, DecisionStep } from './orchestration.types';
import { logger } from '../../config/logger';
import { resolveTemplate, evaluateCondition } from './orchestration.templates';
import * as skillsDispatch from '../skills/skills.dispatch';
import { emitStepCompleted, emitGateWaiting } from './orchestration.events';
import { tasksService } from '../tasks/tasks.service';
import { collaborate } from '../collaboration/collaboration.engine';

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
            callerRole: 'system' as const,
          });
          if (!skillResult.ok) throw new Error(skillResult.error instanceof Error ? skillResult.error.message : String(skillResult.error));
          result = skillResult.value;
          break;
        }

        case 'gate': {
          const prompt = step.gatePrompt
            ? resolveTemplate(step.gatePrompt, stepResults, input)
            : 'Approval required to continue';
          const orchestrationId = input._orchestrationId as string ?? '';
          emitGateWaiting(orchestrationId, step.id, prompt, workspaceId);

          // Use the state-based gate system if we have an orchestrationId,
          // otherwise fall back to the callback for programmatic callers.
          if (orchestrationId) {
            const { createGateRequest } = await import('../../infra/state/orchestration-gates');
            const approved = await createGateRequest(orchestrationId, step.id, workspaceId, 5 * 60 * 1000, prompt);
            if (!approved) {
              return { stepId: step.id, status: 'failed', error: 'Gate rejected by user', durationMs: performance.now() - start };
            }
          } else if (onGate) {
            const approved = await onGate(step.id, prompt);
            if (!approved) {
              return { stepId: step.id, status: 'failed', error: 'Gate rejected by user', durationMs: performance.now() - start };
            }
          }
          result = { approved: true };
          break;
        }

        case 'agent': {
          const agentStep = step as AgentStep;
          const message = agentStep.message
            ? resolveTemplate(agentStep.message, stepResults, input)
            : 'Execute the assigned task';
          const taskResult = await tasksService.send(
            agentStep.agentId,
            message,
            workspaceId,
            'orchestration',
          );
          if (!taskResult.ok) throw new Error(taskResult.error.message);
          result = taskResult.value;
          break;
        }

        case 'collaboration': {
          const collabStep = step as CollaborationStep;
          const query = resolveTemplate(
            (input.query as string) ?? 'Collaborate on the given task',
            stepResults,
            input,
          );
          const dispatch = async (skillId: string, args: Record<string, unknown>) => {
            const r = await skillsDispatch.dispatchSkill(skillId, args, {
              callerId: 'orchestration',
              workspaceId,
              callerRole: 'system' as const,
            });
            if (!r.ok) throw new Error(r.error instanceof Error ? r.error.message : String(r.error));
            return typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
          };
          const collabResult = await collaborate({
            strategy: collabStep.strategy,
            query,
            agents: collabStep.agentIds,
            mergeStrategy: collabStep.mergeStrategy,
            maxRounds: collabStep.maxRounds,
          }, dispatch);
          result = collabResult;
          break;
        }

        case 'decision': {
          const decisionStep = step as DecisionStep;
          // Evaluate previous step results to pick the best pipeline/branch
          const candidates = decisionStep.pipelines ?? [];
          // Use the first pipeline whose step result succeeded, or fall back to first
          let chosen = candidates[0] ?? null;
          for (const candidate of candidates) {
            const candidateResult = stepResults[candidate];
            if (candidateResult && candidateResult.status === 'completed') {
              chosen = candidate;
              break;
            }
          }
          result = { decision: chosen, candidates };
          break;
        }
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
      const blockedSteps = Array.from(pending);
      logger.error(
        { orchestrationId: definition.id, blockedSteps },
        'Orchestration deadlocked — circular dependency or unresolvable step dependencies',
      );
      return {
        orchestrationId: definition.id ?? '',
        status: 'failed',
        error: `Dependency deadlock: steps [${blockedSteps.join(', ')}] could not be scheduled. Check for circular dependencies.`,
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
      emitStepCompleted(input._orchestrationId as string ?? '', result.stepId, result.status, workspaceId);

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
