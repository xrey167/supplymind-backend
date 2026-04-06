import { db } from '../../infra/db/client';
import { sql } from 'drizzle-orm';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors';
import { membersRepo } from './members.repo';
import { invitationsRepo, hashToken } from './invitations.repo';
import type { WorkspaceMember, InviteInput, MemberWithUser, WorkspaceInvitation, WorkspaceRole } from './members.types';

/** Omit tokenHash from invitation responses */
export type InvitationResponse = Omit<WorkspaceInvitation, 'tokenHash'>;

function stripTokenHash(inv: WorkspaceInvitation): InvitationResponse {
  const { tokenHash: _, ...rest } = inv;
  return rest;
}

class MembersService {
  async invite(workspaceId: string, input: InviteInput): Promise<{ token: string; invitation: InvitationResponse }> {
    if (input.role === 'owner') throw new ValidationError('Cannot invite as owner');
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
    return { token: result.token, invitation: stripTokenHash(result.invitation) };
  }

  async acceptInvitation(token: string, userId: string, userEmail: string): Promise<WorkspaceMember> {
    const tokenHashValue = hashToken(token);

    return db.transaction(async (tx) => {
      const invitation = await invitationsRepo.findByTokenHashForUpdate(tx, tokenHashValue);
      if (!invitation) throw new NotFoundError('Invitation not found, expired, or already accepted');

      if (invitation.type === 'email' && invitation.email) {
        if (userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new ForbiddenError('This invitation was sent to a different email address');
        }
      }

      // Check existing membership within the transaction
      const existingRows = await tx.execute(
        sql`SELECT id FROM workspace_members WHERE workspace_id = ${invitation.workspaceId} AND user_id = ${userId} LIMIT 1`,
      );
      if (existingRows.length > 0) throw new ValidationError('Already a member of this workspace');

      // Insert member within the transaction
      const memberRows = await tx.execute(
        sql`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
            VALUES (${invitation.workspaceId}, ${userId}, ${invitation.role}, ${invitation.invitedBy})
            RETURNING id, workspace_id, user_id, role, invited_by, joined_at`,
      );
      const row = memberRows[0]!;

      // Mark invitation as accepted within the transaction
      await tx.execute(
        sql`UPDATE workspace_invitations SET accepted_at = now() WHERE id = ${invitation.id}`,
      );

      const member: WorkspaceMember = {
        id: row.id, workspaceId: row.workspace_id, userId: row.user_id,
        role: row.role, invitedBy: row.invited_by, joinedAt: new Date(row.joined_at),
      };

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
      const memberRows = await tx.execute(
        sql`SELECT id, role FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`,
      );
      const member = memberRows[0];
      if (!member) throw new NotFoundError('Member not found');
      if (member.role === 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot remove the last workspace owner');
      }
      await tx.execute(
        sql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`,
      );
      eventBus.publish(Topics.MEMBER_REMOVED, { workspaceId, userId, removedBy });
    });
  }

  async revokeInvitation(workspaceId: string, id: string): Promise<void> {
    await invitationsRepo.deleteByIdAndWorkspace(workspaceId, id);
  }

  async updateRole(workspaceId: string, userId: string, newRole: WorkspaceRole, changedBy: string): Promise<WorkspaceMember> {
    return db.transaction(async (tx) => {
      const ownerRows = await tx.execute(
        sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role = 'owner' FOR UPDATE`,
      );
      const memberRows = await tx.execute(
        sql`SELECT id, role FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`,
      );
      const member = memberRows[0];
      if (!member) throw new NotFoundError('Member not found');
      if (member.role === 'owner' && newRole !== 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot demote the last workspace owner');
      }
      const updatedRows = await tx.execute(
        sql`UPDATE workspace_members SET role = ${newRole} WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
            RETURNING id, workspace_id, user_id, role, invited_by, joined_at`,
      );
      const updated = updatedRows[0];
      if (!updated) throw new NotFoundError('Member not found');
      eventBus.publish(Topics.MEMBER_ROLE_CHANGED, {
        workspaceId, userId, oldRole: member.role, newRole, changedBy,
      });
      return {
        id: updated.id, workspaceId: updated.workspace_id, userId: updated.user_id,
        role: updated.role, invitedBy: updated.invited_by, joinedAt: new Date(updated.joined_at),
      };
    });
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return membersRepo.listMembers(workspaceId);
  }

  async listPendingInvitations(workspaceId: string): Promise<InvitationResponse[]> {
    const invitations = await invitationsRepo.listPending(workspaceId);
    return invitations.map(stripTokenHash);
  }
}

export const membersService = new MembersService();
