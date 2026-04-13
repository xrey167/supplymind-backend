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
  | 'collab_approval_resolved'
  | 'alert_fired';

export type NotificationChannel = 'in_app' | 'email' | 'websocket' | 'slack' | 'telegram';

export type NotificationStatus = 'pending' | 'delivered' | 'read' | 'failed';

export interface QuietHours {
  start: string;  // "HH:MM" 24h, e.g. "22:00"
  end: string;    // "HH:MM", e.g. "08:00"
  tz: string;     // IANA timezone, e.g. "UTC"
}

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
  recipientEmail?: string;
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
  quietHours: QuietHours | null;
}
