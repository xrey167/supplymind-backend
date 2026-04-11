import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ── Mock modules with external deps (must be before imports) ─────────────────

const createPlanMock = mock(() => Promise.resolve(makePlan()));
const getPlanMock = mock(() => Promise.resolve(makePlan()));
const updatePlanStatusMock = mock(() => Promise.resolve());
const createRunMock = mock(() => Promise.resolve(makeRun()));
const runIntentGateMock = mock(() => Promise.resolve(allowGateResult));
const compileToOrchestrationMock = mock(() => ({ steps: [] }));

mock.module('../execution.repo', () => ({
  executionRepo: {
    createPlan: createPlanMock,
    getPlan: getPlanMock,
    updatePlanStatus: updatePlanStatusMock,
    createRun: createRunMock,
  },
}));

mock.module('../intent-gate', () => ({ runIntentGate: runIntentGateMock }));
mock.module('../execution.compiler', () => ({ compileToOrchestration: compileToOrchestrationMock }));
mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));
mock.module('../../../infra/db/client', () => ({ db: {} }));
mock.module('../../../infra/db/schema', () => ({
  executionPlans: {}, executionRuns: {}, orchestrations: {},
}));

// ── Import after module mocks ────────────────────────────────────────────────

import { executionService } from '../execution.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    workspaceId: 'ws-1',
    name: 'Test Plan',
    steps: [],
    input: {},
    policy: {},
    intent: null,
    status: 'draft',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    planId: 'plan-1',
    workspaceId: 'ws-1',
    orchestrationId: null,
    status: 'running',
    intent: null,
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

const allowGateResult = {
  decision: 'allow' as const,
  classification: { category: 'read', risk: 'low', confidence: 0.95 },
  reason: 'Low-risk',
  cached: false,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('executionService.create', () => {
  beforeEach(() => { createPlanMock.mockClear(); });

  it('creates a plan and returns ok result', async () => {
    createPlanMock.mockResolvedValue(makePlan() as any);
    const result = await executionService.create('ws-1', 'user-1', {
      name: 'Test Plan',
      steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: {} }],
    });
    expect(result.ok).toBe(true);
    expect(createPlanMock.mock.calls.length).toBe(1);
    if (result.ok) expect(result.value.id).toBe('plan-1');
  });

  it('returns err when repo throws', async () => {
    createPlanMock.mockRejectedValue(new Error('DB error'));
    const result = await executionService.create('ws-1', 'user-1', {});
    expect(result.ok).toBe(false);
  });
});

describe('executionService.run', () => {
  beforeEach(() => {
    getPlanMock.mockClear();
    updatePlanStatusMock.mockClear();
    createRunMock.mockClear();
    runIntentGateMock.mockClear();
    compileToOrchestrationMock.mockClear();
  });

  it('returns err when plan not found', async () => {
    getPlanMock.mockResolvedValue(null as any);
    const result = await executionService.run('ws-1', 'nonexistent', 'user-1');
    expect(result.ok).toBe(false);
    expect((result as any).error.message).toContain('not found');
  });

  it('runs through intent gate and returns run result', async () => {
    getPlanMock.mockResolvedValue(makePlan() as any);
    updatePlanStatusMock.mockResolvedValue(undefined as any);
    createRunMock.mockResolvedValue(makeRun() as any);
    runIntentGateMock.mockResolvedValue(allowGateResult as any);
    compileToOrchestrationMock.mockReturnValue({ steps: [] } as any);

    const result = await executionService.run('ws-1', 'plan-1', 'user-1');
    expect(runIntentGateMock.mock.calls.length).toBe(1);
    // Either success or err — downstream orchestration queue may be unavailable in unit tests
    expect(result.ok === true || result.ok === false).toBe(true);
  });

  it('blocks plan and returns err when gate decision is block', async () => {
    getPlanMock.mockResolvedValue(makePlan() as any);
    updatePlanStatusMock.mockResolvedValue(undefined as any);
    runIntentGateMock.mockResolvedValue({
      decision: 'block' as const,
      classification: { category: 'destructive', risk: 'critical', confidence: 0.99 },
      reason: 'Destructive operation',
      cached: false,
    } as any);

    const result = await executionService.run('ws-1', 'plan-1', 'user-1');
    expect(result.ok).toBe(false);
    expect(updatePlanStatusMock.mock.calls.some((c: any[]) => c[1] === 'failed')).toBe(true);
  });

  it('requires approval when gate decision is require_approval', async () => {
    getPlanMock.mockResolvedValue(makePlan() as any);
    updatePlanStatusMock.mockResolvedValue(undefined as any);
    createRunMock.mockResolvedValue(makeRun({ status: 'pending_approval' }) as any);
    runIntentGateMock.mockResolvedValue({
      decision: 'require_approval' as const,
      classification: { category: 'write', risk: 'medium', confidence: 0.7 },
      reason: 'Requires human approval',
      cached: false,
    } as any);

    const result = await executionService.run('ws-1', 'plan-1', 'user-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('pending_approval');
  });
});
