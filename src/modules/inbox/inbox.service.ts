import { inboxRepo } from './inbox.repo';
import type { CreateInboxItemInput, InboxFilter, InboxItem } from './inbox.types';

export class InboxService {
  async add(input: CreateInboxItemInput): Promise<InboxItem> {
    return inboxRepo.create(input);
  }

  async list(userId: string, workspaceId: string, filter?: InboxFilter): Promise<InboxItem[]> {
    return inboxRepo.list(userId, workspaceId, filter);
  }

  async markRead(id: string): Promise<InboxItem | null> {
    return inboxRepo.markRead(id);
  }

  async markAllRead(userId: string, workspaceId: string): Promise<void> {
    return inboxRepo.markAllRead(userId, workspaceId);
  }

  async togglePin(id: string): Promise<InboxItem | null> {
    return inboxRepo.togglePin(id);
  }

  async getUnreadCount(userId: string, workspaceId: string): Promise<number> {
    return inboxRepo.getUnreadCount(userId, workspaceId);
  }

  async cleanup(workspaceId: string, daysOld: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    return inboxRepo.deleteOlderThan(workspaceId, cutoff);
  }
}

export const inboxService = new InboxService();
