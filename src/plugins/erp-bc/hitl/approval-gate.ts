// src/plugins/erp-bc/hitl/approval-gate.ts

import { ok, err } from '../../../core/result';
import type { Result } from '../../../core/result';
import type { BcWriteAction } from './approval-schemas';

/**
 * Creates an ExecutionPlan with a gate step + riskClass: 'critical' for any BC write action.
 */
export async function createApprovalGateForWriteAction(
  workspaceId: string,
  callerId: string,
  action: BcWriteAction,
): Promise<Result<{ planId: string; status: string }>> {
  const { executionService } = await import('../../../modules/execution/execution.service');

  const result = await executionService.create(workspaceId, callerId, {
    name: `BC Write: ${action.actionName} on ${action.entityType}/${action.entityId}`,
    steps: [
      {
        id: 'gate',
        type: 'gate',
        gatePrompt: `Approve BC action: ${action.actionName} on ${action.entityType} entity ${action.entityId}. Reason: ${action.reason}`,
        riskClass: 'critical',
        approvalMode: 'required',
      },
      {
        id: 'execute',
        type: 'skill',
        skillId: 'erp-bc:post-action',
        args: {
          actionName: action.actionName,
          entityType: action.entityType,
          entityId: action.entityId,
          payload: action.payload,
        },
        dependsOn: ['gate'],
        riskClass: 'critical',
      },
    ],
    input: { action },
    policy: { approvalMode: 'required' },
  });

  if (!result.ok) return err(result.error);
  return ok({ planId: result.value.id, status: result.value.status });
}
