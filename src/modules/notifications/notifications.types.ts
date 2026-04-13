export type NotificationType =
  | 'task_completed'
  | 'task_error'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'member_joined'
  | 'subscription_updated'
  | 'agent_failure'
  | 'collab_mention'
  | 'collab_approval_requested'
  | 'collab_approval_resolved';

export type NotificationChannel = 'in_app' | 'email' | 'websocket';

export type NotificationStatus = 'pending' | 'delivered' | 'read' | 'failed';

export interface Notification {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  channel: NotificationChannel;
  status: NotificationStatus;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  workspaceId: string;
  userId?: string;
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationFilter {
  unreadOnly?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  workspaceId: string;
  type: string;
  channels: NotificationChannel[];
  muted: boolean;
}
