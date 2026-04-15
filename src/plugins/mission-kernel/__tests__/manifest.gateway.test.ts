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
});

afterAll(() => mock.restore());
