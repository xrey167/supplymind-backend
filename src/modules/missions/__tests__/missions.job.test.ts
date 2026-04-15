import { describe, it, expect, mock } from 'bun:test';
import type { MissionRun, MissionWorker } from '../missions.types';

// --- Mocks (must be declared before any import that pulls in the target modules) ---

const mockStart = mock(async (id: string) =>
  id === 'mr-1'
    ? { ok: true, value: { id: 'mr-1', name: 'Test', mode: 'task', status: 'running', input: {}, metadata: {}, disciplineMaxRetries: 3, spentCents: 0, costBreakdown: {}, createdAt: new Date(), updatedAt: new Date() } as MissionRun }
    : { ok: false, error: new Error('Mission not found') }
);

const mockCompile = mock(() => ({ kind: 'task', workers: [{ role: 'executor' }] }));
const mockListWorkers = mock(async () => [] as MissionWorker[]);
const mockUpdateWorkerStatus = mock(async () => undefined);
const mockUpdateRunStatus = mock(async () => undefined);
const mockFindRunById = mock(async () => null);

mock.module('../missions.service', () => ({
  missionsService: { start: mockStart },
}));

mock.module('../missions.compiler', () => ({
  compileMission: mockCompile,
}));

mock.module('../missions.repo', () => ({
  missionsRepo: {
    listWorkers: mockListWorkers,
    updateWorkerStatus: mockUpdateWorkerStatus,
    updateRunStatus: mockUpdateRunStatus,
    findRunById: mockFindRunById,
  },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => undefined), warn: mock(() => undefined) },
}));

const { processMissionJob } = await import('../missions.job');

// ---------------------------------------------------------------------------

describe('processMissionJob', () => {
  it('calls missionsService.start with missionId from job data', async () => {
    const job = { data: { missionId: 'mr-1', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).resolves.toBeUndefined();
    expect(mockStart).toHaveBeenCalledWith('mr-1');
  });

  it('compiles the mission and marks run completed when no workers are available', async () => {
    mockCompile.mockClear();
    mockListWorkers.mockClear();
    mockUpdateRunStatus.mockClear();

    const job = { data: { missionId: 'mr-1', workspaceId: 'ws-1' } } as any;
    await processMissionJob(job);

    expect(mockCompile).toHaveBeenCalledTimes(1);
    expect(mockListWorkers).toHaveBeenCalledWith('mr-1');
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('mr-1', 'completed');
  });

  it('throws if start returns err', async () => {
    const job = { data: { missionId: 'unknown', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).rejects.toThrow('Mission not found');
  });

  it('does not update mission run status when start fails', async () => {
    mockUpdateRunStatus.mockClear();
    const job = { data: { missionId: 'unknown', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).rejects.toThrow();
    expect(mockUpdateRunStatus).not.toHaveBeenCalled();
  });
});
