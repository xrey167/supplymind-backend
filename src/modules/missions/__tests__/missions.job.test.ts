import { describe, it, expect, mock, afterAll } from 'bun:test';

const mockStart = mock(async (id: string) =>
  id === 'mr-1'
    ? { ok: true, value: { id: 'mr-1', status: 'running' } }
    : { ok: false, error: new Error('Mission not found') }
);

const _realMissionsService = require('../missions.service');
mock.module('../missions.service', () => ({
  ..._realMissionsService,
  missionsService: { start: mockStart },
}));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: mock(() => undefined), warn: mock(() => undefined) },
}));

const { processMissionJob } = await import('../missions.job');

describe('processMissionJob', () => {
  it('calls missionsService.start with missionId from job data', async () => {
    const job = { data: { missionId: 'mr-1', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).resolves.toBeUndefined();
    expect(mockStart).toHaveBeenCalledWith('mr-1');
  });

  it('throws if start returns err', async () => {
    const job = { data: { missionId: 'unknown', workspaceId: 'ws-1' } } as any;
    await expect(processMissionJob(job)).rejects.toThrow('Mission not found');
  });
});

afterAll(() => mock.restore());
