import { ok, err } from '../../core/result';
import { logger } from '../../config/logger';
import { AppError } from '../../core/errors';
import type { Result } from '../../core/result';
import { workflowsRepo } from './workflows.repo';
import { orchestrationRepo } from '../orchestration/orchestration.repo';
import { enqueueOrchestration } from '../../infra/queue/bullmq';
import type { OrchestrationDefinition } from '../orchestration/orchestration.types';

export const workflowsService = {
  async create(workspaceId: string, callerId: string, input: { name: string; description?: string; definition: unknown }): Promise<Result<any>> {
    const row = await workflowsRepo.create({ ...input, workspaceId, createdBy: callerId });
    return ok(row);
  },

  async list(workspaceId: string): Promise<Result<any>> {
    return ok(await workflowsRepo.list(workspaceId));
  },

  async getById(id: string, workspaceId: string): Promise<Result<any>> {
    const row = await workflowsRepo.getById(id);
    if (!row) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    if (row.workspaceId !== workspaceId) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    return ok(row);
  },

  async update(id: string, workspaceId: string, patch: { name?: string; description?: string; definition?: unknown }): Promise<Result<any>> {
    const existing = await workflowsRepo.getById(id);
    if (!existing) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    if (existing.workspaceId !== workspaceId) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    const row = await workflowsRepo.update(id, patch);
    return ok(row);
  },

  async delete(id: string, workspaceId: string): Promise<Result<void>> {
    const existing = await workflowsRepo.getById(id);
    if (!existing) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    if (existing.workspaceId !== workspaceId) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    await workflowsRepo.delete(id);
    return ok(undefined);
  },

  async runTemplate(templateId: string, workspaceId: string, sessionId?: string, input?: Record<string, unknown>): Promise<Result<{ orchestrationId: string }>> {
    const template = await workflowsRepo.getById(templateId);
    if (!template) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));
    if (template.workspaceId !== workspaceId) return err(new AppError('Workflow template not found', 404, 'NOT_FOUND'));

    const orch = await orchestrationRepo.create({
      workspaceId,
      sessionId,
      name: template.name,
      definition: template.definition as OrchestrationDefinition,
      input: input ?? {},
    });

    try {
      await enqueueOrchestration({
        orchestrationId: orch.id,
        workspaceId,
        definition: template.definition as OrchestrationDefinition,
        input: input ?? {},
      });
    } catch (error) {
      logger.error({ error, orchestrationId: orch.id }, 'Failed to enqueue orchestration after DB write — orphaned record');
      return err(new AppError('Failed to schedule orchestration execution. Please try again.', 503, 'QUEUE_UNAVAILABLE'));
    }

    return ok({ orchestrationId: orch.id });
  },
};
