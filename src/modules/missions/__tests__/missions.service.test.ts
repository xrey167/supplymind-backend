import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockMission = {
  id: 'mr-1',
  workspaceId: 'ws-1',
  name: 'Test',
  mode: 'assist',
  status: 'pending',
  input: {},
  output: null,
  metadata: {},
  disciplineMaxRetries: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

const mockRunningMission = { ...mockMission, status: 'running' };
const mockCompletedMission = { ...mockMission, status: 'completed' };

const mockRepo = {
  createRun: mock(async () => mockMission),
  findRunById: mock(async (id: string) => (id === 'mr-1' ? mockMission : null)),
  listRuns: mock(async () => [mockMission]),
  updateRunStatus: mock(async () => mockRunningMission),
  createWorker: mock(async () => ({ id: 'w-1', role: 'executor', status: 'pending' })),
  updateWorkerStatus: mock(async () => null),
  listWorkers: mock(async () => []),
  createArtifact: mock(async () => ({
    id: 'art-1', missionRunId: 'mr-1', kind: 'text',
    title: null, content: 'hello', contentJson: null,
    metadata: {}, workerId: null, createdAt: new Date(),
  })),
  listArtifacts: mock(async () => []),
};

const mockBus = { publish: mock(async () => undefined) };

mock.module('../../events/bus', () => ({ eventBus: mockBus }));
// MissionTopics imported directly from the plugin (static as const) — no mock needed
mock.module('../missions.repo', () => ({ missionsRepo: mockRepo }));
mock.module('../../core/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(msg = 'Not found') { super(msg); }
  },
  AppError: class AppError extends Error {
    constructor(public message: string, public statusCode = 500, public code?: string) { super(message); }
  },
}));

const { MissionsService } = await import('../missions.service');

describe('MissionsService', () => {
  let service: InstanceType<typeof MissionsService>;

  beforeEach(() => {
    service = new MissionsService(mockRepo as any, mockBus as any);
    mockBus.publish.mockClear();
    mockRepo.findRunById.mockClear();
  });

  it('create() creates mission and publishes event', async () => {
    const r = await service.create('ws-1', { name: 'Test', mode: 'assist' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toBe('mr-1');
    expect(mockBus.publish).toHaveBeenCalledWith('mission.created', expect.anything());
  });

  it('get() returns mission by id', async () => {
    const r = await service.get('mr-1');
    expect(r.ok).toBe(true);
  });

  it('get() returns err for unknown id', async () => {
    const r = await service.get('unknown');
    expect(r.ok).toBe(false);
  });

  it('list() returns array', async () => {
    const missions = await service.list('ws-1');
    expect(Array.isArray(missions)).toBe(true);
  });

  it('start() compiles workers and sets status to running', async () => {
    const r = await service.start('mr-1');
    expect(r.ok).toBe(true);
    expect(mockRepo.createWorker).toHaveBeenCalled();
    expect(mockBus.publish).toHaveBeenCalledWith('mission.started', expect.anything());
  });

  it('start() returns 409 if not pending', async () => {
    mockRepo.findRunById.mockResolvedValueOnce(mockRunningMission as any);
    const r = await service.start('mr-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as any).statusCode).toBe(409);
  });

  it('start() returns err for unknown id', async () => {
    const r = await service.start('unknown');
    expect(r.ok).toBe(false);
  });

  it('pause() returns 409 if not running', async () => {
    const r = await service.pause('mr-1'); // mockMission is 'pending'
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as any).statusCode).toBe(409);
  });

  it('cancel() returns 409 for already-terminal missions', async () => {
    mockRepo.findRunById.mockResolvedValueOnce(mockCompletedMission as any);
    const r = await service.cancel('mr-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as any).statusCode).toBe(409);
  });

  it('emitArtifact() creates artifact and publishes event', async () => {
    const r = await service.emitArtifact({ missionRunId: 'mr-1', kind: 'text', content: 'hello' });
    expect(r.ok).toBe(true);
    expect(mockBus.publish).toHaveBeenCalledWith('mission.artifact.created', expect.anything());
  });
});
