import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { getCacheProvider } from '../../infra/cache';
import { featureFlagsService } from '../feature-flags/feature-flags.service';
import { executionRepo } from './execution.repo';
import { runIntentGate } from './intent-gate';
import { compileToOrchestration } from './execution.compiler';
import { DEFAULT_INTENT_GATE_CONFIG } from './execution.types';
import type {
  ExecutionPlanRow, ExecutionRunRow, ExecutionStep, ExecutionPolicy, IntentGateConfig,
} from './execution.types';

async function loadGateConfig(workspaceId: string): Promise<IntentGateConfig> {
  try {
    const enabled = await featureFlagsService.getValue<boolean>(workspaceId, 'intent_gate_enabled');
    const llmFallback = await featureFlagsService.getValue<boolean>(workspaceId, 'intent_gate_llm_fallback');
    return {
      ...DEFAULT_INTENT_GATE_CONFIG,
      ...(enabled !== null && enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(llmFallback !== null && llmFallback !== undefined ? { llmFallback: Boolean(llmFallback) } : {}),
    };
  } catch {
    return DEFAULT_INTENT_GATE_CONFIG;
  }
}

async function getCacheOps() {
  const cache = getCacheProvider();
  return {
    get: async (key: string): Promise<string | null> => {
      const val = await cache.get<string>(key);
      return val ?? null;
    },
    set: async (key: string, val: string, ttlMs: number): Promise<void> => {
      await cache.set(key, val, ttlMs);
    },
  };
}

export const executionService = {
  async create(
    workspaceId: string,
    createdBy: string,
    data: { name?: string; steps: ExecutionStep[]; input?: Record<string, unknown>; policy?: ExecutionPolicy },
  ): Promise<Result<ExecutionPlanRow>> {
    const plan = await executionRepo.createPlan({
      workspaceId,
      name: data.name,
      steps: data.steps,
      input: data.input,
      policy: data.policy,
      createdBy,
    });
    return ok(plan);
  },

  async run(
    workspaceId: string,
    planId: string,
    callerId: string,
  ): Promise<Result<{ planId: string; runId: string; orchestrationId: string; status: string }>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));
    if (plan.status !== 'draft') return err(new Error(`Plan is not in draft status: ${plan.status}`));

    const gateConfig = await loadGateConfig(workspaceId);
    const { get, set } = await getCacheOps();
    const gateResult = await runIntentGate(plan.steps, plan.input, gateConfig, get, set);

    await executionRepo.updatePlanStatus(planId, 'pending_approval', gateResult.classification);

    if (gateResult.decision === 'block') {
      await executionRepo.updatePlanStatus(planId, 'failed');
      return err(new Error(`Plan blocked by Intent-Gate: ${gateResult.reason}`));
    }

    if (gateResult.decision === 'require_approval') {
      try {
        const { inboxService } = await import('../inbox/inbox.service');
        await inboxService.add({
          workspaceId,
          type: 'task_update',
          title: `Approval required: ${plan.name ?? planId}`,
          body: `Intent-Gate requires approval. Category: ${gateResult.classification.category}. ${gateResult.reason}`,
          sourceType: 'task',
          sourceId: planId,
          metadata: { planId, gateResult },
        });
      } catch (inboxErr) {
        logger.warn({ err: inboxErr, planId }, 'Failed to create inbox item for plan approval');
      }
      return ok({ planId, runId: '', orchestrationId: '', status: 'pending_approval' });
    }

    return executionService._executeCompiled(plan, workspaceId, callerId, gateResult.classification);
  },

  async approve(
    workspaceId: string,
    planId: string,
    callerId: string,
  ): Promise<Result<{ planId: string; runId: string; orchestrationId: string; status: string }>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));
    if (plan.status !== 'pending_approval') return err(new Error(`Plan not awaiting approval: ${plan.status}`));

    return executionService._executeCompiled(plan, workspaceId, callerId, plan.intent ?? {
      category: 'ops', confidence: 1.0, method: 'rules', cached: false,
    });
  },

  async _executeCompiled(
    plan: ExecutionPlanRow,
    workspaceId: string,
    callerId: string,
    intent: ExecutionPlanRow['intent'],
  ): Promise<Result<{ planId: string; runId: string; orchestrationId: string; status: string }>> {
    const definition = compileToOrchestration(plan.steps, (plan.policy as ExecutionPolicy | undefined)?.maxConcurrency as number | undefined);

    const { orchestrationService } = await import('../orchestration/orchestration.service');
    const orch = await orchestrationService.create({
      workspaceId,
      name: plan.name ?? undefined,
      definition,
      input: { ...plan.input, _planId: plan.id },
    });

    const run = await executionRepo.createRun({
      planId: plan.id,
      workspaceId,
      intent: intent ?? { category: 'ops', confidence: 1.0, method: 'rules', cached: false },
      orchestrationId: orch.id,
    });

    await executionRepo.updatePlanStatus(plan.id, 'running');

    try {
      const { enqueueOrchestration } = await import('../../infra/queue/bullmq');
      await enqueueOrchestration({
        orchestrationId: orch.id,
        workspaceId,
        definition,
        input: { ...plan.input, _planId: plan.id },
      });
    } catch (queueErr) {
      logger.warn({ err: queueErr, planId: plan.id }, 'Failed to enqueue orchestration — plan marked failed');
      await executionRepo.updatePlanStatus(plan.id, 'failed');
      return err(new Error('Failed to schedule execution'));
    }

    return ok({ planId: plan.id, runId: run.id, orchestrationId: orch.id, status: 'running' });
  },

  async get(workspaceId: string, planId: string): Promise<ExecutionPlanRow | undefined> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return undefined;
    return plan;
  },

  async list(workspaceId: string, limit?: number): Promise<ExecutionPlanRow[]> {
    return executionRepo.listPlans(workspaceId, limit);
  },

  async getRuns(workspaceId: string, planId: string): Promise<Result<ExecutionRunRow[]>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));
    const runs = await executionRepo.getRunsByPlan(planId);
    return ok(runs);
  },
};
