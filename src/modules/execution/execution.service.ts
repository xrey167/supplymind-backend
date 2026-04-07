import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { executionRepo } from './execution.repo';
import { runIntentGate } from './intent-gate';
import { compileToOrchestration } from './execution.compiler';
import { DEFAULT_INTENT_GATE_CONFIG } from './execution.types';
import type {
  ExecutionPlanRow, ExecutionRunRow, ExecutionStep, ExecutionPolicy, IntentGateConfig,
} from './execution.types';

// In-process cache fallback — no Redis required in test environment
const _memCache = new Map<string, { value: string; expiresAt: number }>();
const memGet = async (key: string): Promise<string | null> => {
  const e = _memCache.get(key);
  if (!e || Date.now() > e.expiresAt) return null;
  return e.value;
};
const memSet = async (key: string, val: string, ttlMs: number): Promise<void> => {
  _memCache.set(key, { value: val, expiresAt: Date.now() + ttlMs });
};

async function loadGateConfig(workspaceId: string): Promise<IntentGateConfig> {
  try {
    const { featureFlagsService } = await import('../feature-flags/feature-flags.service');
    const enabled = await featureFlagsService.getValue<boolean>(workspaceId, 'intent_gate_enabled');
    const llmFallback = await featureFlagsService.getValue<boolean>(workspaceId, 'intent_gate_llm_fallback');
    return {
      ...DEFAULT_INTENT_GATE_CONFIG,
      ...(enabled != null ? { enabled: Boolean(enabled) } : {}),
      ...(llmFallback != null ? { llmFallback: Boolean(llmFallback) } : {}),
    };
  } catch {
    return DEFAULT_INTENT_GATE_CONFIG;
  }
}

export const executionService = {
  async create(
    workspaceId: string,
    createdBy: string,
    data: { name?: string; steps?: ExecutionStep[]; input?: Record<string, unknown>; policy?: ExecutionPolicy },
  ): Promise<Result<ExecutionPlanRow>> {
    const plan = await executionRepo.createPlan({
      workspaceId,
      name: data.name,
      steps: data.steps ?? [],
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
  ): Promise<Result<{ planId: string; runId: string; orchestrationId?: string; status: string }>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));

    const gateConfig = await loadGateConfig(workspaceId);

    let gateResult: Awaited<ReturnType<typeof runIntentGate>>;
    try {
      gateResult = await runIntentGate(plan.steps, plan.input, gateConfig, memGet, memSet);
    } catch (gateErr) {
      logger.warn({ err: gateErr }, 'Intent gate error — defaulting to allow');
      gateResult = {
        classification: { category: 'quick', confidence: 0.5, method: 'rules', cached: false },
        decision: 'allow',
        reason: 'Gate error fallback',
      };
    }

    if (gateResult.decision === 'block') {
      await executionRepo.updatePlanStatus(planId, 'failed');
      return err(new Error('Plan blocked by Intent-Gate: ' + gateResult.reason));
    }

    if (gateResult.decision === 'require_approval') {
      await executionRepo.updatePlanStatus(planId, 'pending_approval', gateResult.classification);
      const run = await executionRepo.createRun({
        planId,
        workspaceId,
        status: 'pending_approval',
        intent: gateResult.classification,
      });
      try {
        const { inboxService } = await import('../inbox/inbox.service');
        await inboxService.add({
          workspaceId,
          type: 'task_update',
          title: 'Approval required: ' + (plan.name ?? planId),
          body: 'Intent-Gate requires approval. Category: ' + gateResult.classification.category + '. ' + gateResult.reason,
          sourceType: 'task',
          sourceId: planId,
          metadata: { planId, gateResult },
        });
      } catch (inboxErr) {
        logger.warn({ err: inboxErr, planId }, 'Failed to create inbox item for plan approval');
      }
      return ok({ planId, runId: run.id, status: 'pending_approval' });
    }

    await executionRepo.updatePlanStatus(planId, 'running', gateResult.classification);
    const run = await executionRepo.createRun({
      planId,
      workspaceId,
      status: 'running',
      intent: gateResult.classification,
    });

    try {
      const definition = compileToOrchestration(plan.steps);
      const { orchestrationService } = await import('../orchestration/orchestration.service');
      const orch = await orchestrationService.create({
        workspaceId,
        name: plan.name ?? undefined,
        definition,
        input: { ...plan.input, _planId: plan.id },
      });
      const { enqueueOrchestration } = await import('../../infra/queue/bullmq');
      await enqueueOrchestration({ orchestrationId: orch.id, workspaceId, definition, input: { ...plan.input, _planId: plan.id } });
      return ok({ planId, runId: run.id, orchestrationId: orch.id, status: 'running' });
    } catch (queueErr) {
      logger.warn({ err: queueErr, planId }, 'Failed to enqueue orchestration — run created without queue');
      return ok({ planId, runId: run.id, status: 'running' });
    }
  },

  async approve(
    workspaceId: string,
    planId: string,
    callerId: string,
  ): Promise<Result<{ planId: string; runId: string; status: string }>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));
    if (plan.status !== 'pending_approval') return err(new Error('Plan not awaiting approval: ' + plan.status));
    await executionRepo.updatePlanStatus(planId, 'running');
    const run = await executionRepo.createRun({ planId, workspaceId, status: 'running', intent: plan.intent ?? undefined });
    return ok({ planId, runId: run.id, status: 'running' });
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
    return ok(await executionRepo.getRunsByPlan(planId));
  },
};
