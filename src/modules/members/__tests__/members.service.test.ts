import { describe, it, expect, beforeEach, mock } from 'bun:test';

// --- Mock modules before importing service ---

const mockMembersRepo = {
  addMember: mock(async () => ({
    id: 'member-1', workspaceId: 'ws-1', userId: 'user-1',
    role: 'member', invitedBy: 'owner-1', joinedAt: new Date(),
  })),
  findMember: mock(async () => null),
  listMembers: mock(async () => []),
  updateRole: mock(async () => null),
  removeMember: mock(async () => {}),
  countOwners: mock(async () => 1),
  findByUserId: mock(async () => []),
};

const mockInvitationsRepo = {
  create: mock(async () => ({
    token: 'tok123',
    invitation: {
      id: 'inv-1', workspaceId: 'ws-1', email: 'alice@example.com',
      tokenHash: 'hash', type: 'email' as const, role: 'member',
      invitedBy: 'owner-1', expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null, createdAt: new Date(),
    },
  })),
  findPendingByEmail: mock(async () => null),
  findByTokenHashForUpdate: mock(async () => null),
  listPending: mock(async () => []),
  accept: mock(async () => {}),
  deleteById: mock(async () => {}),
  deleteByIdAndWorkspace: mock(async () => {}),
  deleteExpired: mock(async () => 0),
  deleteByWorkspace: mock(async () => {}),
};

const mockPublish = mock(() => {});
const mockEventBus = { publish: mockPublish, subscribe: mock(() => 'sub-mock'), unsubscribe: mock(() => {}) };

// tx.execute is called multiple times per transaction — configure per test
const executeCalls: (() => Promise<any>)[] = [];
const mockTx = {
  execute: mock(async (...args: any[]) => {
    const fn = executeCalls.shift();
    return fn ? fn() : [];
  }),
};
const mockDb = {
  transaction: mock(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
};

mock.module('../members.repo', () => ({ membersRepo: mockMembersRepo }));
mock.module('../invitations.repo', () => ({
  invitationsRepo: mockInvitationsRepo,
  hashToken: (token: string) => `hashed_${token}`,
}));
const _realBus = require('../../../events/bus');
const _origMembersPublish = _realBus.eventBus.publish.bind(_realBus.eventBus);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'publish') return (...args: any[]) => { mockPublish(...args); return _origMembersPublish(...args); };
      return target[prop];
    },
  }),
}));
const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({ ..._realDbClient, db: mockDb }));

// Import after mocks
const { membersService } = await import('../members.service');

describe('MembersService', () => {
  beforeEach(() => {
    mockMembersRepo.addMember.mockClear();
    mockMembersRepo.findMember.mockClear();
    mockMembersRepo.listMembers.mockClear();
    mockMembersRepo.updateRole.mockClear();
    mockMembersRepo.removeMember.mockClear();
    mockInvitationsRepo.create.mockClear();
    mockInvitationsRepo.findPendingByEmail.mockClear();
    mockInvitationsRepo.findByTokenHashForUpdate.mockClear();
    mockInvitationsRepo.accept.mockClear();
    mockPublish.mockClear();
    mockDb.transaction.mockClear();
    mockTx.execute.mockClear();
    executeCalls.length = 0;
  });

  // ---- invite ----

  describe('invite', () => {
    it('creates an email invitation and publishes MEMBER_INVITED', async () => {
      mockInvitationsRepo.findPendingByEmail.mockResolvedValueOnce(null);

      const result = await membersService.invite('ws-1', {
        email: 'alice@example.com', role: 'member', invitedBy: 'owner-1',
      });

      expect(mockInvitationsRepo.findPendingByEmail).toHaveBeenCalledWith('ws-1', 'alice@example.com');
      expect(mockInvitationsRepo.create).toHaveBeenCalledWith('ws-1', {
        email: 'alice@example.com', type: 'email', role: 'member', invitedBy: 'owner-1',
      });
      expect(result.token).toBe('tok123');
      expect(result.invitation.id).toBe('inv-1');
      // tokenHash should be stripped from response
      expect((result.invitation as any).tokenHash).toBeUndefined();
      expect(mockPublish).toHaveBeenCalledWith(
        'member.invited',
        expect.objectContaining({ workspaceId: 'ws-1', email: 'alice@example.com' }),
      );
    });

    it('creates a link invitation (no email) without duplicate check', async () => {
      await membersService.invite('ws-1', { invitedBy: 'owner-1' });

      expect(mockInvitationsRepo.findPendingByEmail).not.toHaveBeenCalled();
      expect(mockInvitationsRepo.create).toHaveBeenCalledWith('ws-1', expect.objectContaining({ type: 'link' }));
    });

    it('throws ValidationError if email invitation already pending', async () => {
      mockInvitationsRepo.findPendingByEmail.mockResolvedValueOnce({
        id: 'inv-existing', workspaceId: 'ws-1', email: 'alice@example.com',
        tokenHash: 'h', type: 'email', role: 'member', invitedBy: 'owner-1',
        expiresAt: new Date(), acceptedAt: null, createdAt: new Date(),
      });

      await expect(
        membersService.invite('ws-1', { email: 'alice@example.com', invitedBy: 'owner-1' }),
      ).rejects.toThrow('Invitation already pending');
    });

    it('throws ValidationError when trying to invite as owner', async () => {
      await expect(
        membersService.invite('ws-1', { email: 'alice@example.com', role: 'owner', invitedBy: 'owner-1' }),
      ).rejects.toThrow('Cannot invite as owner');
    });
  });

  // ---- acceptInvitation ----

  describe('acceptInvitation', () => {
    const baseInvitation = {
      id: 'inv-1', workspaceId: 'ws-1', email: 'alice@example.com',
      tokenHash: 'hash', type: 'email' as const, role: 'member',
      invitedBy: 'owner-1', expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null, createdAt: new Date(),
    };

    it('adds member and publishes MEMBER_JOINED on valid token', async () => {
      mockInvitationsRepo.findByTokenHashForUpdate.mockResolvedValueOnce(baseInvitation);
      // tx.execute calls: 1) check existing member (empty), 2) insert member, 3) mark accepted
      executeCalls.push(
        async () => [], // no existing member
        async () => [{ id: 'member-1', workspace_id: 'ws-1', user_id: 'user-1', role: 'member', invited_by: 'owner-1', joined_at: new Date().toISOString() }],
        async () => [], // update accepted_at
      );

      const member = await membersService.acceptInvitation('sometoken', 'user-1', 'alice@example.com');

      expect(member.userId).toBe('user-1');
      expect(mockPublish).toHaveBeenCalledWith('member.joined', expect.objectContaining({ userId: 'user-1' }));
    });

    it('throws NotFoundError when invitation not found', async () => {
      mockInvitationsRepo.findByTokenHashForUpdate.mockResolvedValueOnce(null);

      await expect(
        membersService.acceptInvitation('badtoken', 'user-1', 'alice@example.com'),
      ).rejects.toThrow('Invitation not found');
    });

    it('throws ForbiddenError when email does not match', async () => {
      mockInvitationsRepo.findByTokenHashForUpdate.mockResolvedValueOnce(baseInvitation);

      await expect(
        membersService.acceptInvitation('sometoken', 'user-2', 'bob@example.com'),
      ).rejects.toThrow('different email address');
    });

    it('throws ValidationError if user is already a member', async () => {
      mockInvitationsRepo.findByTokenHashForUpdate.mockResolvedValueOnce(baseInvitation);
      executeCalls.push(async () => [{ id: 'member-1' }]); // existing member found

      await expect(
        membersService.acceptInvitation('sometoken', 'user-1', 'alice@example.com'),
      ).rejects.toThrow('Already a member');
    });
  });

  // ---- removeMember ----

  describe('removeMember', () => {
    it('removes a member and publishes MEMBER_REMOVED', async () => {
      // tx.execute calls: 1) owner rows, 2) find member, 3) delete member
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }, { user_id: 'owner-2' }], // 2 owners
        async () => [{ id: 'member-1', role: 'member' }], // target member
        async () => [], // delete
      );

      await membersService.removeMember('ws-1', 'user-2', 'owner-1');

      expect(mockPublish).toHaveBeenCalledWith('member.removed', expect.objectContaining({ userId: 'user-2' }));
    });

    it('throws ForbiddenError when removing the last owner', async () => {
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }], // only 1 owner
        async () => [{ id: 'member-1', role: 'owner' }], // target is that owner
      );

      await expect(
        membersService.removeMember('ws-1', 'owner-1', 'owner-1'),
      ).rejects.toThrow('Cannot remove the last workspace owner');
    });

    it('throws NotFoundError when member not found', async () => {
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }], // owners
        async () => [], // member not found
      );

      await expect(
        membersService.removeMember('ws-1', 'ghost', 'owner-1'),
      ).rejects.toThrow('Member not found');
    });
  });

  // ---- updateRole ----

  describe('updateRole', () => {
    it('updates role and publishes MEMBER_ROLE_CHANGED', async () => {
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }, { user_id: 'owner-2' }], // owners
        async () => [{ id: 'member-1', role: 'member' }], // current member
        async () => [{ id: 'member-1', workspace_id: 'ws-1', user_id: 'user-2', role: 'admin', invited_by: null, joined_at: new Date().toISOString() }], // updated
      );

      const updated = await membersService.updateRole('ws-1', 'user-2', 'admin', 'owner-1');

      expect(updated.role).toBe('admin');
      expect(mockPublish).toHaveBeenCalledWith('member.role_changed', expect.objectContaining({
        userId: 'user-2', oldRole: 'member', newRole: 'admin',
      }));
    });

    it('blocks demotion of the last owner', async () => {
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }], // only 1 owner
        async () => [{ id: 'member-1', role: 'owner' }], // target is that owner
      );

      await expect(
        membersService.updateRole('ws-1', 'owner-1', 'admin', 'owner-1'),
      ).rejects.toThrow('Cannot demote the last workspace owner');
    });

    it('throws NotFoundError when member not found', async () => {
      executeCalls.push(
        async () => [{ user_id: 'owner-1' }], // owners
        async () => [], // member not found
      );

      await expect(
        membersService.updateRole('ws-1', 'ghost', 'admin', 'owner-1'),
      ).rejects.toThrow('Member not found');
    });
  });

  // ---- listMembers ----

  describe('listMembers', () => {
    it('delegates to membersRepo.listMembers', async () => {
      const fakeMembers = [
        {
          id: 'member-1', workspaceId: 'ws-1', userId: 'user-1',
          role: 'owner' as const, invitedBy: null, joinedAt: new Date(),
          userName: 'Alice', userEmail: 'alice@example.com', userAvatarUrl: null,
        },
      ];
      mockMembersRepo.listMembers.mockResolvedValueOnce(fakeMembers);

      const result = await membersService.listMembers('ws-1');

      expect(mockMembersRepo.listMembers).toHaveBeenCalledWith('ws-1');
      expect(result).toEqual(fakeMembers);
    });
  });
});
