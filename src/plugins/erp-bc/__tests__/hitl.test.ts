import { describe, it, expect, mock } from 'bun:test';

const createdPlans: any[] = [];

mock.module('../../../modules/execution/execution.service', () => ({
  executionService: {
    create: async (_wsId: string, _caller: string, data: any) => {
      createdPlans.push(data);
      return { ok: true, value: { id: 'plan-1', status: 'draft', ...data } };
    },
  },
}));

const { createApprovalGateForWriteAction } = await import('../hitl/approval-gate');

describe('createApprovalGateForWriteAction', () => {
  it('creates an ExecutionPlan with gate + execute steps', async () => {
    const result = await createApprovalGateForWriteAction('ws-1', 'user-1', {
      actionName: 'postInvoice',
      entityType: 'purchaseOrders',
      entityId: 'po-123',
      reason: 'Month-end close',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.planId).toBe('plan-1');

    const plan = createdPlans[0];
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].type).toBe('gate');
    expect(plan.steps[0].riskClass).toBe('critical');
    expect(plan.steps[1].type).toBe('skill');
    expect(plan.steps[1].dependsOn).toContain('gate');
    expect(plan.policy.approvalMode).toBe('required');
  });
});
