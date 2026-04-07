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
const mockPublish = mock(() => {});

mock.module('../../../infra/db/client', () => ({ db: {} }));
mock.module('../../../infra/db/schema', () => ({ users: {} }));
mock.module('drizzle-orm', () => ({ eq: mock(() => {}) }));

mock.module('../users.repo', () => ({
  usersRepo: { upsert: mockUpsert, delete: mockDelete, updateLastSeen: mock(async () => {}) },
}));

mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish, subscribe: () => 'sub-mock', unsubscribe: () => {} },
}));

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), debug: mock(() => {}), error: mock(() => {}), info: mock(() => {}) },
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
    expect(mockUpsert.mock.calls[0]![0]).toMatchObject({
      id: 'user_1',
      email: 'test@example.com',
      name: 'Test User',
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0]![0]).toBe(Topics.USER_SYNCED);
    expect(mockPublish.mock.calls[0]![1]).toMatchObject({ action: 'created' });
  });

  it('user.updated — calls upsert and publishes USER_SYNCED with action=updated', async () => {
    await usersService.syncFromClerk({ ...makeCreatedEvent(), type: 'user.updated' });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0]![1]).toMatchObject({ action: 'updated' });
  });

  it('user.deleted — calls delete and publishes USER_DELETED', async () => {
    await usersService.syncFromClerk({ type: 'user.deleted', data: { id: 'user_1' } });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0]![0]).toBe('user_1');
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0]![0]).toBe(Topics.USER_DELETED);
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
