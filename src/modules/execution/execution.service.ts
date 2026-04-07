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
const MAX_CACHE_SIZE = 500;
const _memCache = new Map<string, { value: string; expiresAt: number }>();

function cacheGet(key: string): string | null {
  const entry = _memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    _memCache.delete(key);
    return null;
  }
  // Move to end (LRU)
  _memCache.delete(key);
  _memCache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: string, ttlMs: number): void {
  if (_memCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (first key)
    const firstKey = _memCache.keys().next().value;
    if (firstKey !== undefined) _memCache.delete(firstKey);
  }
  _memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function memGet(key: string): Promise<string | null> { return cacheGet(key); }
async function memSet(key: string, val: string, ttlMs: number): Promise<void> { cacheSet(key, val, ttlMs); }

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
  } catch (flagErr) {
    logger.warn({ err: flagErr, workspaceId }, 'Intent gate: failed to load feature flags — using defaults');
    return DEFAULT_INTENT_GATE_CONFIG;
  }
}

export const executionService = {
  async create(
    workspaceId: string,
    createdBy: string,
    data: { name?: string; steps?: ExecutionStep[]; input?: Record<string, unknown>; policy?: ExecutionPolicy },
  ): Promise<Result<ExecutionPlanRow>> {
    try {
      const plan = await executionRepo.createPlan({
        workspaceId,
        name: data.name,
        steps: data.steps ?? [],
        input: data.input,
        policy: data.policy,
        createdBy,
      });
      return ok(plan);
    } catch (e) {
      logger.warn({ err: e, workspaceId }, 'Failed to create execution plan');
      return err(e instanceof Error ? e : new Error(String(e)));
    }
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
      logger.error({ err: gateErr, planId }, 'Intent gate error — blocking execution for safety');
      return err(new Error('Intent gate is unavailable — plan execution blocked. Please retry.'));
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
      logger.warn({ err: queueErr, planId }, 'Failed to enqueue orchestration — marking plan failed');
      await executionRepo.updatePlanStatus(planId, 'failed');
      return err(new Error('Failed to schedule execution'));
    }
  },

  async approve(
    workspaceId: string,
    planId: string,
    callerId: string,
  ): Promise<Result<{ planId: string; runId: string; orchestrationId?: string; status: string }>> {
    const plan = await executionRepo.getPlan(planId);
    if (!plan || plan.workspaceId !== workspaceId) return err(new Error('Plan not found'));
    if (plan.status !== 'pending_approval') return err(new Error('Plan not awaiting approval: ' + plan.status));

    const intent = plan.intent ?? { category: 'ops' as const, confidence: 1.0, method: 'rules' as const, cached: false };

    // Compile + enqueue (same path as run() after gate passes)
    const definition = compileToOrchestration(plan.steps, (plan.policy as any)?.maxConcurrency);
    const { orchestrationService } = await import('../orchestration/orchestration.service');
    const orch = await orchestrationService.create({
      workspaceId,
      name: plan.name ?? undefined,
      definition,
      input: { ...plan.input, _planId: plan.id },
    });
    const run = await executionRepo.createRun({ planId: plan.id, workspaceId, status: 'running', intent });
    await executionRepo.updatePlanStatus(plan.id, 'running');

    try {
      const { enqueueOrchestration } = await import('../../infra/queue/bullmq');
      await enqueueOrchestration({ orchestrationId: orch.id, workspaceId, definition, input: { ...plan.input, _planId: plan.id } });
    } catch (queueErr) {
      logger.warn({ err: queueErr, planId: plan.id }, 'Failed to enqueue — marking failed');
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
    return ok(await executionRepo.getRunsByPlan(planId));
  },
};
