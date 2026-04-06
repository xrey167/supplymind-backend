export type InboxItemType = 'notification' | 'task_update' | 'system' | 'alert';

export interface InboxItem {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: InboxItemType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  sourceType: string | null;
  sourceId: string | null;
  read: boolean;
  pinned: boolean;
  createdAt: Date;
}

export interface CreateInboxItemInput {
  workspaceId: string;
  userId?: string;
  type: InboxItemType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  sourceType?: string;
  sourceId?: string;
}

export interface InboxFilter {
  unreadOnly?: boolean;
  type?: InboxItemType;
  pinned?: boolean;
  limit?: number;
  offset?: number;
}
