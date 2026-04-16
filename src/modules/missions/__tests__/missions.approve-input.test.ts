import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Shared mock objects (created before mock.module() calls)
// ---------------------------------------------------------------------------

const mockPausedMission = {
  id: 'mr-1',
  workspaceId: 'ws-1',
  name: 'Test',
  mode: 'assist',
  status: 'paused',
  input: {},
  output: null,
  metadata: {},
  disciplineMaxRetries: 3,
  budgetCents: null,
  spentCents: 0,
  costBreakdown: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

const mockRunningMission  = { ...mockPausedMission, status: 'running' };
const mockRejectedMission = { ...mockPausedMission, status: 'rejected' };
const mockPendingMission  = { ...mockPausedMission, status: 'pending' };

const mockRepo = {
  createRun:          mock(async () => mockPausedMission),
  findRunById:        mock(async (id: string) => (id === 'mr-1' ? mockPausedMission : null)),
  listRuns:           mock(async () => []),
  updateRunStatus:    mock(async () => mockRunningMission),
  updateRunInput:     mock(async () => undefined),
  createWorker:       mock(async () => ({ id: 'w-1', role: 'executor', status: 'pending' })),
  updateWorkerStatus: mock(async () => null),
  listWorkers:        mock(async () => []),
  createArtifact:     mock(async () => ({
    id: 'art-1', missionRunId: 'mr-1', kind: 'text',
    title: null, content: null, contentJson: null,
    metadata: {}, workerId: null, createdAt: new Date(),
  })),
  listArtifacts:      mock(async () => []),
};

const mockBus = { publish: mock(async () => undefined) };

// ---------------------------------------------------------------------------
// Module mocks — paths resolve from this file's directory
// ---------------------------------------------------------------------------

const _realBus = require('../../../events/bus');
mock.module('../../events/bus', () => ({
  ..._realBus,
  eventBus: { ..._realBus.eventBus, ...mockBus },
}));

const _realMissionsRepo = require('../missions.repo');
mock.module('../missions.repo', () => ({
  ..._realMissionsRepo,
  missionsRepo: mockRepo,
}));

const _realCoreErrors = require('../../../core/errors');
mock.module('../../core/errors', () => ({
  ..._realCoreErrors,
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(msg = 'Not found') { super(msg); }
  },
  AppError: class AppError extends Error {
    constructor(
      public message: string,
      public statusCode = 500,
      public code?: string,
    ) { super(message); }
  },
}));

const { MissionsService } = await import('../missions.service');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MissionsService — approve() and input()', () => {
  let service: InstanceType<typeof MissionsService>;

  beforeEach(() => {
    service = new MissionsService(mockRepo as any, mockBus as any);
    mockBus.publish.mockClear();
    mockRepo.findRunById.mockClear();
    mockRepo.updateRunStatus.mockClear();
    mockRepo.updateRunInput.mockClear();
    // Restore default: paused mission for id 'mr-1', null otherwise
    mockRepo.findRunById.mockImplementation(async (id: string) =>
      id === 'mr-1' ? mockPausedMission : null,
    );
    mockRepo.updateRunStatus.mockImplementation(async () => mockRunningMission);
  });

  // -------------------------------------------------------------------------
  // approve() — approved = true
  // -------------------------------------------------------------------------

  it('approve(id, true) sets status to running and publishes MISSION_RESUMED with reason "approved"', async () => {
    mockRepo.updateRunStatus.mockImplementationOnce(async () => mockRunningMission);

    const result = await service.approve('mr-1', true);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('running');

    expect(mockRepo.updateRunStatus).toHaveBeenCalledWith('mr-1', 'running');
    expect(mockBus.publish).toHaveBeenCalledWith(
      'mission.resumed',
      expect.objectContaining({
        missionId: 'mr-1',
        reason: 'approved',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // approve() — approved = false
  // -------------------------------------------------------------------------

  it('approve(id, false) sets status to rejected and publishes MISSION_REJECTED with reason "approval_rejected"', async () => {
    mockRepo.updateRunStatus.mockImplementationOnce(async () => mockRejectedMission);

    const result = await service.approve('mr-1', false);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('rejected');

    expect(mockRepo.updateRunStatus).toHaveBeenCalledWith('mr-1', 'rejected');
    expect(mockBus.publish).toHaveBeenCalledWith(
      'mission.rejected',
      expect.objectContaining({
        missionId: 'mr-1',
        reason: 'approval_rejected',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // approve() — non-paused run returns 409
  // -------------------------------------------------------------------------

  it('approve(id, true) on a non-paused run returns error with statusCode 409', async () => {
    mockRepo.findRunById.mockImplementationOnce(async () => mockPendingMission);

    const result = await service.approve('mr-1', true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).statusCode).toBe(409);

    // No status update should occur
    expect(mockRepo.updateRunStatus).not.toHaveBeenCalled();
    expect(mockBus.publish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // input() — paused run receives payload
  // -------------------------------------------------------------------------

  it('input(id, payload) calls updateRunInput, sets status to running, publishes MISSION_RESUMED with reason "input_received"', async () => {
    const payload = { answer: 'yes', quantity: 42 };
    mockRepo.updateRunStatus.mockImplementationOnce(async () => mockRunningMission);

    const result = await service.input('mr-1', payload);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('running');

    expect(mockRepo.updateRunInput).toHaveBeenCalledWith('mr-1', payload);
    expect(mockRepo.updateRunStatus).toHaveBeenCalledWith('mr-1', 'running');
    expect(mockBus.publish).toHaveBeenCalledWith(
      'mission.resumed',
      expect.objectContaining({
        missionId: 'mr-1',
        reason: 'input_received',
        input: payload,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // input() — non-paused run returns 409
  // -------------------------------------------------------------------------

  it('input(id, payload) on a non-paused run returns error with statusCode 409', async () => {
    mockRepo.findRunById.mockImplementationOnce(async () => mockRunningMission);
    const payload = { answer: 'no' };

    const result = await service.input('mr-1', payload);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).statusCode).toBe(409);

    // Neither the input nor the status should be updated
    expect(mockRepo.updateRunInput).not.toHaveBeenCalled();
    expect(mockRepo.updateRunStatus).not.toHaveBeenCalled();
    expect(mockBus.publish).not.toHaveBeenCalled();
  });
});
