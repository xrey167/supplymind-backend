import { describe, test, expect, mock, afterAll } from 'bun:test';
import { ok } from '../../../core/result';

const createMock = mock(async () => ok({ id: 'm1' } as any));
const _realMissionsService = require('../../../modules/missions/missions.service');
mock.module('../../../modules/missions/missions.service', () => ({
  ..._realMissionsService,
  missionsService: {
    ..._realMissionsService.missionsService,
    create: createMock,
  },
}));

const enqueueMock = mock(async (data: any) => ({ queued: true as const, missionId: data.missionId }));
mock.module('../queue', () => ({ enqueueMission: enqueueMock }));

import { missionKernelManifest } from '../manifest';

describe('missionKernelManifest gateway ops', () => {
  test('mission.create forwards disciplineMaxRetries', async () => {
    const createOp = missionKernelManifest.contributions?.gatewayOps?.find((entry) => entry.op === 'mission.create');
    expect(createOp).toBeDefined();

    await createOp!.handler({
      op: 'mission.create' as any,
      context: { workspaceId: 'ws-1' } as any,
      params: {
        name: 'Disciplined mission',
        mode: 'discipline',
        disciplineMaxRetries: 7,
      },
    });

    expect(createMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ disciplineMaxRetries: 7 }));
  });

  test('mission.start enqueues the job and returns queued acknowledgment', async () => {
    const startOp = missionKernelManifest.contributions?.gatewayOps?.find((entry) => entry.op === 'mission.start');
    expect(startOp).toBeDefined();

    const result = await startOp!.handler({
      op: 'mission.start' as any,
      context: { workspaceId: 'ws-1' } as any,
      params: { id: 'mr-42' },
    });

    expect(enqueueMock).toHaveBeenCalledWith({ missionId: 'mr-42', workspaceId: 'ws-1' });
    expect(result).toEqual({ ok: true, value: { queued: true, missionId: 'mr-42' } });
  });
});

afterAll(() => mock.restore());
