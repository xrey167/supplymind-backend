import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import type { MissionRun } from '../../../modules/missions/missions.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateRunSpent  = mock(async (_id: string, _cents: number) => null as MissionRun | null);
const mockUpdateRunStatus = mock(async () => null);
const mockPublish         = mock(async () => undefined);

let subscriberHandler: ((event: { data: unknown }) => Promise<void>) | null = null;
let capturedSubscriptionName: string | null = null;

const mockSubscribe = mock((topic: string, handler: (event: { data: unknown }) => Promise<void>, opts?: { name?: string }) => {
  subscriberHandler = handler;
  capturedSubscriptionName = opts?.name ?? null;
  return 'sub-id-1';
});

const mockUnsubscribe = mock((_id: string) => undefined);

mock.module('../../../modules/missions/missions.repo', () => ({
  missionsRepo: {
    updateRunSpent:  mockUpdateRunSpent,
    updateRunStatus: mockUpdateRunStatus,
  },
}));

mock.module('../../../events/bus', () => ({
  eventBus: {
    subscribe:   mockSubscribe,
    unsubscribe: mockUnsubscribe,
    publish:     mockPublish,
  },
}));

mock.module('../../../plugins/mission-kernel/topics', () => ({
  MissionTopics: {
    MISSION_BUDGET_EXCEEDED: 'mission.budget_exceeded',
  },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => undefined), warn: mock(() => undefined) },
}));

const { registerMissionBudgetTracker } = await import('../budget-tracker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    id: 'run-1', workspaceId: 'ws-1', name: 'Test', mode: 'task', status: 'running',
    input: {}, metadata: {}, disciplineMaxRetries: 3,
    spentCents: 0, costBreakdown: {}, budgetCents: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

async function fireTaskCompleted(data: Record<string, unknown>): Promise<void> {
  if (!subscriberHandler) throw new Error('No subscriber registered');
  await subscriberHandler({ data });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerMissionBudgetTracker', () => {
  beforeEach(() => {
    mockUpdateRunSpent.mockClear();
    mockUpdateRunStatus.mockClear();
    mockPublish.mockClear();
    subscriberHandler = null;
  });

  it('subscribes to task.completed events', () => {
    registerMissionBudgetTracker();
    expect(mockSubscribe).toHaveBeenCalledWith(
      'task.completed',
      expect.any(Function),
      expect.objectContaining({ name: 'mission-budget-tracker' }),
    );
  });

  it('returns unsubscribe function', () => {
    const unsubscribe = registerMissionBudgetTracker();
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('ignores events without missionRunId', async () => {
    registerMissionBudgetTracker();
    await fireTaskCompleted({ costUsd: 1.5 });
    expect(mockUpdateRunSpent).not.toHaveBeenCalled();
  });

  it('ignores events with zero or negative cost', async () => {
    registerMissionBudgetTracker();
    await fireTaskCompleted({ missionRunId: 'run-1', costUsd: 0 });
    expect(mockUpdateRunSpent).not.toHaveBeenCalled();
  });

  it('increments spentCents by costUsd converted to cents', async () => {
    mockUpdateRunSpent.mockImplementationOnce(async () => makeRun({ spentCents: 50, budgetCents: null }));
    registerMissionBudgetTracker();
    await fireTaskCompleted({ missionRunId: 'run-1', costUsd: 0.50 });
    expect(mockUpdateRunSpent).toHaveBeenCalledWith('run-1', 50);
  });

  it('publishes MISSION_BUDGET_EXCEEDED and pauses run when budget is hit', async () => {
    mockUpdateRunSpent.mockImplementationOnce(async () =>
      makeRun({ spentCents: 100, budgetCents: 100 }),
    );
    registerMissionBudgetTracker();
    await fireTaskCompleted({ missionRunId: 'run-1', costUsd: 0.30 });

    expect(mockPublish).toHaveBeenCalledWith(
      'mission.budget_exceeded',
      expect.objectContaining({ missionRunId: 'run-1' }),
    );
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'paused');
  });

  it('does not pause when spent is still below budget', async () => {
    mockUpdateRunSpent.mockImplementationOnce(async () =>
      makeRun({ spentCents: 50, budgetCents: 200 }),
    );
    registerMissionBudgetTracker();
    await fireTaskCompleted({ missionRunId: 'run-1', costUsd: 0.50 });

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdateRunStatus).not.toHaveBeenCalled();
  });

  it('does not pause when run has no budget', async () => {
    mockUpdateRunSpent.mockImplementationOnce(async () =>
      makeRun({ spentCents: 999, budgetCents: null }),
    );
    registerMissionBudgetTracker();
    await fireTaskCompleted({ missionRunId: 'run-1', costUsd: 9.99 });

    expect(mockUpdateRunStatus).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
