import { db } from '../../infra/db/client';
import { sql } from 'drizzle-orm';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors';
import { membersRepo } from './members.repo';
import { invitationsRepo } from './invitations.repo';
import type { WorkspaceMember, InviteInput, MemberWithUser, WorkspaceInvitation } from './members.types';

class MembersService {
  async invite(workspaceId: string, input: InviteInput): Promise<{ token: string; invitation: WorkspaceInvitation }> {
    const type = input.email ? 'email' : 'link';
    if (input.email) {
      const existing = await invitationsRepo.findPendingByEmail(workspaceId, input.email);
      if (existing) throw new ValidationError(`Invitation already pending for ${input.email}`);
    }
    const result = await invitationsRepo.create(workspaceId, {
      email: input.email, type, role: input.role ?? 'member', invitedBy: input.invitedBy,
    });
    eventBus.publish(Topics.MEMBER_INVITED, {
      workspaceId, email: input.email, type,
      role: input.role ?? 'member', invitedBy: input.invitedBy,
      invitationId: result.invitation.id,
    });
    return result;
  }

  async acceptInvitation(token: string, userId: string, userEmail: string): Promise<WorkspaceMember> {
    const tokenHash = (() => { const h = new Bun.CryptoHasher('sha256'); h.update(token); return h.digest('hex'); })();

    return db.transaction(async (tx) => {
      const invitation = await invitationsRepo.findByTokenHashForUpdate(tx, tokenHash);
      if (!invitation) throw new NotFoundError('Invitation not found, expired, or already accepted');

      if (invitation.type === 'email' && invitation.email) {
        if (userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new ForbiddenError('This invitation was sent to a different email address');
        }
      }

      const existingMember = await membersRepo.findMember(invitation.workspaceId, userId);
      if (existingMember) throw new ValidationError('Already a member of this workspace');

      const member = await membersRepo.addMember(invitation.workspaceId, userId, invitation.role, invitation.invitedBy);
      await invitationsRepo.accept(invitation.id);

      eventBus.publish(Topics.MEMBER_JOINED, {
        workspaceId: invitation.workspaceId, userId, role: invitation.role, invitedBy: invitation.invitedBy,
      });
      return member;
    });
  }

  async removeMember(workspaceId: string, userId: string, removedBy: string): Promise<void> {
    return db.transaction(async (tx) => {
      const ownerRows = await tx.execute(
        sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role = 'owner' FOR UPDATE`,
      );
      const member = await membersRepo.findMember(workspaceId, userId);
      if (!member) throw new NotFoundError('Member not found');
      if (member.role === 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot remove the last workspace owner');
      }
      await membersRepo.removeMember(workspaceId, userId);
      eventBus.publish(Topics.MEMBER_REMOVED, { workspaceId, userId, removedBy });
    });
  }

  async updateRole(workspaceId: string, userId: string, newRole: string, changedBy: string): Promise<WorkspaceMember> {
    return db.transaction(async (tx) => {
      const ownerRows = await tx.execute(
        sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role = 'owner' FOR UPDATE`,
      );
      const member = await membersRepo.findMember(workspaceId, userId);
      if (!member) throw new NotFoundError('Member not found');
      if (member.role === 'owner' && newRole !== 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot demote the last workspace owner');
      }
      const updated = await membersRepo.updateRole(workspaceId, userId, newRole);
      if (!updated) throw new NotFoundError('Member not found');
      eventBus.publish(Topics.MEMBER_ROLE_CHANGED, {
        workspaceId, userId, oldRole: member.role, newRole, changedBy,
      });
      return updated;
    });
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return membersRepo.listMembers(workspaceId);
  }

  async listPendingInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return invitationsRepo.listPending(workspaceId);
  }
}

export const membersService = new MembersService();
