import { describe, it, expect, mock, afterAll } from 'bun:test';
import type { MissionRun, MissionWorker } from '../missions.types';

// --- Mocks (must be declared before any import that pulls in the target modules) ---

const mockStart = mock(async (id: string) =>
  id === 'mr-1'
    ? { ok: true, value: { id: 'mr-1', name: 'Test', mode: 'task', status: 'running', input: {}, metadata: {}, disciplineMaxRetries: 3, spentCents: 0, costBreakdown: {}, createdAt: new Date(), updatedAt: new Date() } as MissionRun }
    : { ok: false, error: new Error('Mission not found') }
);

const mockCompile = mock(() => ({ kind: 'task', workers: [{ role: 'executor' }] }));
const mockListWorkers = mock(async () => [] as MissionWorker[]);
const mockExecuteMission = mock(async () => undefined);

mock.module('../missions.service', () => ({
  missionsService: { start: mockStart },
}));

mock.module('../missions.compiler', () => ({
  compileMission: mockCompile,
}));

mock.module('../missions.repo', () => ({
  missionsRepo: {
    listWorkers:        mockListWorkers,
    updateWorkerStatus: mock(async () => undefined),
    updateRunStatus:    mock(async () => undefined),
    findRunById:        mock(async () => null),
  },
}));

// Path from test at src/modules/missions/__tests__/ → src/plugins/mission-kernel/executor
mock.module('../../../plugins/mission-kernel/executor', () => ({
  executeMission: mockExecuteMission,
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

  it('compiles the mission and dispatches workers via executor on success', async () => {
    mockExecuteMission.mockClear();
    mockCompile.mockClear();
    mockListWorkers.mockClear();

    const job = { data: { missionId: 'mr-1', workspaceId: 'ws-1' } } as any;
    await processMissionJob(job);

    expect(mockCompile).toHaveBeenCalledTimes(1);
    expect(mockListWorkers).toHaveBeenCalledWith('mr-1');
    expect(mockExecuteMission).toHaveBeenCalledTimes(1);
  });

  it('throws if start returns err', async () => {
    const job = { data: { missionId: 'unknown', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).rejects.toThrow('Mission not found');
  });

  it('does not call executor when start fails', async () => {
    mockExecuteMission.mockClear();
    const job = { data: { missionId: 'unknown', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).rejects.toThrow();
    expect(mockExecuteMission).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
