import { usersRepo } from './users.repo';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import type { ClerkWebhookEvent } from './users.types';

class UsersService {
  async syncFromClerk(event: ClerkWebhookEvent): Promise<void> {
    const { type, data } = event;

    switch (type) {
      case 'user.created':
      case 'user.updated': {
        const primaryEmail = data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id,
        );
        if (!primaryEmail) {
          logger.warn({ userId: data.id }, 'Clerk webhook: no primary email found, skipping');
          return;
        }
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
        await usersRepo.upsert({
          id: data.id,
          email: primaryEmail.email_address,
          name,
          avatarUrl: data.image_url ?? null,
        });
        eventBus.publish(Topics.USER_SYNCED, {
          userId: data.id,
          email: primaryEmail.email_address,
          action: type === 'user.created' ? 'created' : 'updated',
        });
        break;
      }

      case 'user.deleted': {
        await this.handleOrphanedWorkspaces(data.id);
        await usersRepo.delete(data.id);
        eventBus.publish(Topics.USER_DELETED, { userId: data.id });
        break;
      }

      default:
        logger.debug({ type }, 'Clerk webhook: unhandled event type');
    }
  }

  private async handleOrphanedWorkspaces(userId: string): Promise<void> {
    // Import lazily to avoid circular dependency
    const { membersRepo } = await import('../members/members.repo');
    const { workspacesRepo } = await import('../workspaces/workspaces.repo');

    const membershipRows = await membersRepo.findByUserId(userId);
    for (const membership of membershipRows) {
      if (membership.role !== 'owner') continue;
      const ownerCount = await membersRepo.countOwners(membership.workspaceId);
      if (ownerCount <= 1) {
        logger.warn({ workspaceId: membership.workspaceId, userId }, 'Soft-deleting orphaned workspace (sole owner deleted from Clerk)');
        await workspacesRepo.softDelete(membership.workspaceId);
        eventBus.publish(Topics.WORKSPACE_DELETING, {
          workspaceId: membership.workspaceId,
          deletedBy: 'system:clerk-user-deleted',
        });
      }
    }
  }
}

export const usersService = new UsersService();
