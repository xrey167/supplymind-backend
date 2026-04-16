import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { MissionRun, MissionWorker, MissionPlan } from '../../../modules/missions/missions.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateWorkerStatus = mock(async () => undefined);
const mockUpdateRunStatus    = mock(async () => undefined);
const mockFindRunById        = mock(async (id: string) => makeRun({ id, budgetCents: null, spentCents: 0 }));
const mockListWorkers        = mock(async () => [] as MissionWorker[]);

const mockResolveForCategory = mock(async () => null);
const mockFindByWorkspace    = mock(async () => [{ id: 'agent-1', model: 'claude-sonnet-4-6' }]);

const mockExecute  = mock(async () => ({ ok: true, value: { taskId: 'task-1' } }));
const mockRunPhases = mock(async () => undefined);

const mockPublish = mock(async () => undefined);

mock.module('../../../modules/missions/missions.repo', () => ({
  missionsRepo: {
    updateWorkerStatus: mockUpdateWorkerStatus,
    updateRunStatus:    mockUpdateRunStatus,
    findRunById:        mockFindRunById,
    listWorkers:        mockListWorkers,
  },
}));

mock.module('../../../modules/agents/agents.repo', () => ({
  agentsRepo: { findByWorkspace: mockFindByWorkspace },
}));

const _realAgentProfiles = require('../../../modules/agent-profiles/agent-profiles.service');
mock.module('../../../modules/agent-profiles/agent-profiles.service', () => ({
  ..._realAgentProfiles,
  agentProfilesService: { resolveForCategory: mockResolveForCategory },
}));

mock.module('../../../core/gateway/gateway', () => ({
  execute: mockExecute,
}));

mock.module('../../../engine/coordinator', () => ({
  coordinatorMode: { run: mockRunPhases },
}));

mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) },
}));

const { executeMission } = await import('../executor');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    name: 'Test Mission',
    mode: 'autopilot',
    status: 'running',
    input: {},
    metadata: {},
    disciplineMaxRetries: 3,
    spentCents: 0,
    costBreakdown: {},
    budgetCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWorker(overrides: Partial<MissionWorker> = {}): MissionWorker {
  return {
    id: 'worker-1',
    missionRunId: 'run-1',
    role: 'executor',
    status: 'pending',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeMission', () => {
  beforeEach(() => {
    mockUpdateWorkerStatus.mockClear();
    mockUpdateRunStatus.mockClear();
    mockExecute.mockClear();
    mockRunPhases.mockClear();
    mockPublish.mockClear();
    mockFindRunById.mockImplementation(async (id) => makeRun({ id, budgetCents: null, spentCents: 0 }));
  });

  it('completes immediately when worker list is empty', async () => {
    const run = makeRun();
    await executeMission(run, { kind: 'task' } as MissionPlan, []);
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  describe('task plan', () => {
    it('dispatches single worker and marks run completed', async () => {
      const run = makeRun();
      const worker = makeWorker();
      await executeMission(run, { kind: 'task' } as MissionPlan, [worker]);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'task.send' }),
      );
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('marks run failed when no agent is available', async () => {
      mockFindByWorkspace.mockImplementationOnce(async () => []);
      const run = makeRun();
      const worker = makeWorker();
      await executeMission(run, { kind: 'task' } as MissionPlan, [worker]);

      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'failed');
    });
  });

  describe('collaboration plan', () => {
    it('dispatches all workers in parallel and marks completed', async () => {
      const run = makeRun();
      const workers = [makeWorker({ id: 'w-1' }), makeWorker({ id: 'w-2' })];
      await executeMission(run, { kind: 'collaboration' } as MissionPlan, workers);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('marks run failed if any worker fails', async () => {
      mockExecute.mockImplementationOnce(async () => { throw new Error('gateway error'); });
      const run = makeRun();
      const workers = [makeWorker({ id: 'w-1' }), makeWorker({ id: 'w-2' })];
      await executeMission(run, { kind: 'collaboration' } as MissionPlan, workers);

      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'failed');
    });
  });

  describe('orchestration plan', () => {
    it('calls coordinatorMode.run once per phase with correct workspaceId', async () => {
      // Two workers in different phases → 2 phase groups → 2 separate run() calls,
      // each receiving a single-phase array (phases: [phase]).
      const run = makeRun();
      const workers = [
        makeWorker({ id: 'w-1', phase: 'plan' }),
        makeWorker({ id: 'w-2', phase: 'execute' }),
      ];
      await executeMission(run, { kind: 'orchestration' } as MissionPlan, workers);

      expect(mockRunPhases).toHaveBeenCalledTimes(2);
      const firstArg = (mockRunPhases.mock.calls as any[][])[0][0];
      expect(firstArg.workspaceId).toBe('ws-1');
      expect(firstArg.phases).toHaveLength(1);
    });
  });

  describe('budget gate', () => {
    it('pauses run and publishes MISSION_BUDGET_EXCEEDED when budget is exhausted', async () => {
      mockFindRunById.mockImplementationOnce(async (id) =>
        makeRun({ id, budgetCents: 100, spentCents: 100 }),
      );
      const run = makeRun({ budgetCents: 100, spentCents: 100 });
      await executeMission(run, { kind: 'task' } as MissionPlan, [makeWorker()]);

      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledWith(
        expect.stringContaining('budget'),
        expect.any(Object),
      );
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'paused');
    });

    it('allows dispatch when spent is below budget', async () => {
      mockFindRunById.mockImplementationOnce(async (id) =>
        makeRun({ id, budgetCents: 500, spentCents: 100 }),
      );
      const run = makeRun({ budgetCents: 500, spentCents: 100 });
      await executeMission(run, { kind: 'task' } as MissionPlan, [makeWorker()]);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('collaboration — budget exhaustion (task #15)', () => {
    it('does not dispatch any worker and sets run to paused when budget is exhausted', async () => {
      // Collaboration does one pre-flight checkBudget before dispatching all workers.
      // When spentCents >= budgetCents the check returns false and execution stops.
      mockFindRunById.mockImplementationOnce(async (id) =>
        makeRun({ id, budgetCents: 200, spentCents: 200 }),
      );
      const run = makeRun({ budgetCents: 200, spentCents: 200 });
      const workers = [makeWorker({ id: 'w-1' }), makeWorker({ id: 'w-2' })];

      await executeMission(run, { kind: 'collaboration' } as MissionPlan, workers);

      // No agent dispatch — neither worker should have been sent
      expect(mockExecute).not.toHaveBeenCalled();
      // checkBudget publishes the budget exceeded event and pauses the run
      expect(mockPublish).toHaveBeenCalledWith(
        expect.stringContaining('budget'),
        expect.any(Object),
      );
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-1', 'paused');
      // Must NOT be marked completed or failed
      expect(mockUpdateRunStatus).not.toHaveBeenCalledWith('run-1', 'completed');
      expect(mockUpdateRunStatus).not.toHaveBeenCalledWith('run-1', 'failed');
    });
  });

  describe('orchestration — resolveAgentId failure (task #16)', () => {
    it('rejects and does not call updateRunStatus when findByWorkspace throws', async () => {
      // In orchestration mode the phase-building step is not wrapped in try-catch.
      // If resolveAgentId throws, executeMission itself rejects.
      mockFindByWorkspace.mockImplementationOnce(async () => {
        throw new Error('no agents');
      });

      const run = makeRun();
      const workers = [
        makeWorker({ id: 'w-1', phase: 'plan' }),
        makeWorker({ id: 'w-2', phase: 'plan' }),
      ];

      await expect(
        executeMission(run, { kind: 'orchestration' } as MissionPlan, workers),
      ).rejects.toThrow('no agents');

      // No status update should have been attempted
      expect(mockUpdateRunStatus).not.toHaveBeenCalled();
    });
  });
});
