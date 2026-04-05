import { orchestrationRepo } from './orchestration.repo';
import { runOrchestration } from './orchestration.engine';
import { emitOrchestrationStarted, emitOrchestrationCompleted, emitOrchestrationFailed } from './orchestration.events';
import type { OrchestrationDefinition, OrchestrationResult } from './orchestration.types';
import { ok, err } from '../../core/result';
import { AppError } from '../../core/errors';
import type { Result } from '../../core/result';

export const orchestrationService = {
  async create(data: {
    workspaceId: string;
    sessionId?: string;
    name?: string;
    definition: OrchestrationDefinition;
    input?: Record<string, unknown>;
  }) {
    return orchestrationRepo.create(data);
  },

  async run(
    orchestrationId: string,
    workspaceId: string,
    definition: OrchestrationDefinition,
    input: Record<string, unknown> = {},
    onGate?: (stepId: string, prompt: string) => Promise<boolean>,
  ): Promise<OrchestrationResult> {
    emitOrchestrationStarted(orchestrationId, workspaceId);
    await orchestrationRepo.updateStatus(orchestrationId, 'running');

    try {
      const result = await runOrchestration(
        definition,
        workspaceId,
        { ...input, _orchestrationId: orchestrationId },
        onGate,
      );

      await orchestrationRepo.updateStatus(orchestrationId, result.status, {
        stepResults: result.stepResults,
        currentStepId: null,
      });

      if (result.status === 'completed') {
        emitOrchestrationCompleted(orchestrationId, workspaceId);
      } else {
        emitOrchestrationFailed(orchestrationId, workspaceId, 'One or more steps failed');
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await orchestrationRepo.updateStatus(orchestrationId, 'failed');
      emitOrchestrationFailed(orchestrationId, workspaceId, msg);
      throw error;
    }
  },

  async get(id: string) {
    return orchestrationRepo.get(id);
  },

  async list(workspaceId: string, opts?: { limit?: number; cursor?: string }) {
    return orchestrationRepo.list(workspaceId, opts);
  },

  async cancel(id: string, workspaceId: string): Promise<Result<void>> {
    const orch = await orchestrationRepo.get(id);
    if (!orch) return err(new AppError('Orchestration not found', 404, 'NOT_FOUND'));
    if (orch.workspaceId !== workspaceId) return err(new AppError('Not found', 404, 'NOT_FOUND'));

    const cancelled = await orchestrationRepo.cancel(id);
    if (!cancelled) return err(new AppError('Orchestration cannot be cancelled (already completed or failed)', 400, 'INVALID_STATE'));

    emitOrchestrationFailed(id, workspaceId, 'Cancelled by user');
    return ok(undefined);
  },
};
