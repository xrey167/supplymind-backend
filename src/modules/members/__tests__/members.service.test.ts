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
  deleteExpired: mock(async () => 0),
  deleteByWorkspace: mock(async () => {}),
};

const mockPublish = mock(() => {});
const mockEventBus = { publish: mockPublish };

// Mock the transaction to just call the callback with a tx that has execute returning []
const mockTx = {
  execute: mock(async () => [{ user_id: 'owner-1' }]),
};
const mockDb = {
  transaction: mock(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
};

mock.module('../members.repo', () => ({ membersRepo: mockMembersRepo }));
mock.module('../invitations.repo', () => ({ invitationsRepo: mockInvitationsRepo }));
mock.module('../../../events/bus', () => ({ eventBus: mockEventBus }));
mock.module('../../../infra/db/client', () => ({ db: mockDb }));

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
      mockMembersRepo.findMember.mockResolvedValueOnce(null);
      mockMembersRepo.addMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'user-1',
        role: 'member', invitedBy: 'owner-1', joinedAt: new Date(),
      });

      const member = await membersService.acceptInvitation('sometoken', 'user-1', 'alice@example.com');

      expect(member.userId).toBe('user-1');
      expect(mockInvitationsRepo.accept).toHaveBeenCalledWith('inv-1');
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
      mockMembersRepo.findMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'user-1',
        role: 'member', invitedBy: null, joinedAt: new Date(),
      });

      await expect(
        membersService.acceptInvitation('sometoken', 'user-1', 'alice@example.com'),
      ).rejects.toThrow('Already a member');
    });
  });

  // ---- removeMember ----

  describe('removeMember', () => {
    it('removes a member and publishes MEMBER_REMOVED', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'user-2',
        role: 'member', invitedBy: null, joinedAt: new Date(),
      });
      // tx.execute returns 2 owners so removal is safe
      mockTx.execute.mockResolvedValueOnce([{ user_id: 'owner-1' }, { user_id: 'owner-2' }]);

      await membersService.removeMember('ws-1', 'user-2', 'owner-1');

      expect(mockMembersRepo.removeMember).toHaveBeenCalledWith('ws-1', 'user-2');
      expect(mockPublish).toHaveBeenCalledWith('member.removed', expect.objectContaining({ userId: 'user-2' }));
    });

    it('throws ForbiddenError when removing the last owner', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'owner-1',
        role: 'owner', invitedBy: null, joinedAt: new Date(),
      });
      mockTx.execute.mockResolvedValueOnce([{ user_id: 'owner-1' }]); // only 1 owner

      await expect(
        membersService.removeMember('ws-1', 'owner-1', 'owner-1'),
      ).rejects.toThrow('Cannot remove the last workspace owner');
    });

    it('throws NotFoundError when member not found', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce(null);

      await expect(
        membersService.removeMember('ws-1', 'ghost', 'owner-1'),
      ).rejects.toThrow('Member not found');
    });
  });

  // ---- updateRole ----

  describe('updateRole', () => {
    it('updates role and publishes MEMBER_ROLE_CHANGED', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'user-2',
        role: 'member', invitedBy: null, joinedAt: new Date(),
      });
      mockTx.execute.mockResolvedValueOnce([{ user_id: 'owner-1' }, { user_id: 'owner-2' }]);
      mockMembersRepo.updateRole.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'user-2',
        role: 'admin', invitedBy: null, joinedAt: new Date(),
      });

      const updated = await membersService.updateRole('ws-1', 'user-2', 'admin', 'owner-1');

      expect(updated.role).toBe('admin');
      expect(mockPublish).toHaveBeenCalledWith('member.role_changed', expect.objectContaining({
        userId: 'user-2', oldRole: 'member', newRole: 'admin',
      }));
    });

    it('blocks demotion of the last owner', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce({
        id: 'member-1', workspaceId: 'ws-1', userId: 'owner-1',
        role: 'owner', invitedBy: null, joinedAt: new Date(),
      });
      mockTx.execute.mockResolvedValueOnce([{ user_id: 'owner-1' }]); // only 1 owner

      await expect(
        membersService.updateRole('ws-1', 'owner-1', 'admin', 'owner-1'),
      ).rejects.toThrow('Cannot demote the last workspace owner');
    });

    it('throws NotFoundError when member not found', async () => {
      mockMembersRepo.findMember.mockResolvedValueOnce(null);

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
          role: 'owner', invitedBy: null, joinedAt: new Date(),
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
