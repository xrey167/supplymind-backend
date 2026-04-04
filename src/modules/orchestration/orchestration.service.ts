import { orchestrationRepo } from './orchestration.repo';
import { runOrchestration } from './orchestration.engine';
import { emitOrchestrationStarted, emitOrchestrationCompleted, emitOrchestrationFailed } from './orchestration.events';
import type { OrchestrationDefinition, OrchestrationResult } from './orchestration.types';

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
};
