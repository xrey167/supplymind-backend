export type ActorType = 'user' | 'agent' | 'system' | 'api_key';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'invite'
  | 'settings_change'
  | 'credential_access'
  | 'plan_change';

export type ResourceType =
  | 'agent'
  | 'credential'
  | 'workspace'
  | 'member'
  | 'settings'
  | 'subscription'
  | 'task'
  | 'skill';

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string;
  actorType: ActorType;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  workspaceId: string;
  actorId: string;
  actorType: ActorType;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogFilter {
  workspaceId: string;
  actorId?: string;
  action?: AuditAction;
  resourceType?: ResourceType;
  resourceId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}
