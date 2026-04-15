import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

// ---- Mocks ----------------------------------------------------------------

const mockUpsert = mock(async () => ({
  id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  lastSeenAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const mockDelete = mock(async () => {});
const mockPublish = mock((..._args: any[]) => {});

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({ ..._realDbClient, db: {} }));
const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({ ..._realSchema, users: {} }));
const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({ ..._realDrizzle, eq: mock(() => {}) }));

const _realUsersRepo = require('../users.repo');
mock.module('../users.repo', () => ({
  ..._realUsersRepo,
  usersRepo: { ..._realUsersRepo.usersRepo, upsert: mockUpsert, delete: mockDelete, updateLastSeen: mock(async () => {}) },
}));

const _realBus = require('../../../events/bus');
const _origUsersPublish = _realBus.eventBus.publish.bind(_realBus.eventBus);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'publish') return (...args: [string, unknown, any?]) => { mockPublish(...args); return _origUsersPublish(...args); };
      return target[prop];
    },
  }),
}));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: new Proxy(_realLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (prop === 'warn') return mock(() => {});
      if (prop === 'debug') return mock(() => {});
      if (prop === 'error') return mock(() => {});
      if (prop === 'info') return mock(() => {});
      return target[prop];
    },
  }),
}));

// ---- Import after mocks ---------------------------------------------------

import { usersService } from '../users.service';
import { Topics } from '../../../events/topics';
import { membersRepo } from '../../members/members.repo';
import { workspacesRepo } from '../../workspaces/workspaces.repo';

// ---- Cross-module spies (restored in afterAll to avoid pollution) ---------

const findByUserIdSpy = spyOn(membersRepo, 'findByUserId').mockResolvedValue([]);
const countOwnersSpy = spyOn(membersRepo, 'countOwners').mockResolvedValue(2);
const softDeleteSpy = spyOn(workspacesRepo, 'softDelete').mockResolvedValue(undefined as any);

afterAll(() => {
  findByUserIdSpy.mockRestore();
  countOwnersSpy.mockRestore();
  softDeleteSpy.mockRestore();
});

// ---- Helpers ---------------------------------------------------------------

function makeCreatedEvent(overrides?: Partial<{ primary_email_address_id: string; email_addresses: any[] }>) {
  return {
    type: 'user.created' as const,
    data: {
      id: 'user_1',
      email_addresses: [{ id: 'email_1', email_address: 'test@example.com' }],
      primary_email_address_id: 'email_1',
      first_name: 'Test',
      last_name: 'User',
      image_url: null,
      ...overrides,
    },
  };
}

// ---- Tests -----------------------------------------------------------------

describe('UsersService.syncFromClerk', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockDelete.mockClear();
    mockPublish.mockClear();
    findByUserIdSpy.mockClear();
    countOwnersSpy.mockClear();
    softDeleteSpy.mockClear();
  });

  it('user.created — calls upsert and publishes USER_SYNCED', async () => {
    await usersService.syncFromClerk(makeCreatedEvent());

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect((mockUpsert.mock.calls as any[][])[0]![0]).toMatchObject({
      id: 'user_1',
      email: 'test@example.com',
      name: 'Test User',
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect((mockPublish.mock.calls as any[][])[0]![0]).toBe(Topics.USER_SYNCED);
    expect((mockPublish.mock.calls as any[][])[0]![1]).toMatchObject({ action: 'created' });
  });

  it('user.updated — calls upsert and publishes USER_SYNCED with action=updated', async () => {
    await usersService.syncFromClerk({ ...makeCreatedEvent(), type: 'user.updated' });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect((mockPublish.mock.calls as any[][])[0]![1]).toMatchObject({ action: 'updated' });
  });

  it('user.deleted — calls delete and publishes USER_DELETED', async () => {
    await usersService.syncFromClerk({ type: 'user.deleted', data: { id: 'user_1' } });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect((mockDelete.mock.calls as any[][])[0]![0]).toBe('user_1');
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect((mockPublish.mock.calls as any[][])[0]![0]).toBe(Topics.USER_DELETED);
  });

  it('skips upsert and publish when no primary email found', async () => {
    await usersService.syncFromClerk(
      makeCreatedEvent({ primary_email_address_id: 'nonexistent', email_addresses: [] }),
    );

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('ignores unknown event types without throwing', async () => {
    await expect(
      usersService.syncFromClerk({ type: 'session.created', data: { id: 'user_1' } }),
    ).resolves.toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
