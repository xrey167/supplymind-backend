import { eventBus } from '../bus';
import { Topics } from '../topics';
import { logger } from '../../config/logger';
import { auditLogsService } from '../../modules/audit-logs/audit-logs.service';
import type { AuditAction, ResourceType } from '../../modules/audit-logs/audit-logs.types';

interface AgentEventData {
  workspaceId: string;
  agentId: string;
  userId?: string;
}

interface CredentialEventData {
  workspaceId: string;
  credentialId: string;
  userId?: string;
}

interface BillingEventData {
  workspaceId: string;
  subscriptionId?: string;
  plan?: string;
}

interface MemberEventData {
  workspaceId: string;
  userId: string;
  invitedBy?: string;
}

export function initAuditLogHandler() {
  // Agent CRUD
  eventBus.subscribe(Topics.AGENT_CREATED, (event) => {
    const data = event.data as AgentEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId ?? 'system',
      actorType: data.userId ? 'user' : 'system',
      action: 'create',
      resourceType: 'agent',
      resourceId: data.agentId,
    });
  }, { name: 'audit-log.handler.agent_created' });

  eventBus.subscribe(Topics.AGENT_UPDATED, (event) => {
    const data = event.data as AgentEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId ?? 'system',
      actorType: data.userId ? 'user' : 'system',
      action: 'update',
      resourceType: 'agent',
      resourceId: data.agentId,
    });
  }, { name: 'audit-log.handler.agent_updated' });

  eventBus.subscribe(Topics.AGENT_DELETED, (event) => {
    const data = event.data as AgentEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId ?? 'system',
      actorType: data.userId ? 'user' : 'system',
      action: 'delete',
      resourceType: 'agent',
      resourceId: data.agentId,
    });
  }, { name: 'audit-log.handler.agent_deleted' });

  // Credentials
  eventBus.subscribe(Topics.CREDENTIAL_CREATED, (event) => {
    const data = event.data as CredentialEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId ?? 'system',
      actorType: data.userId ? 'user' : 'system',
      action: 'create',
      resourceType: 'credential',
      resourceId: data.credentialId,
    });
  }, { name: 'audit-log.handler.credential_created' });

  eventBus.subscribe(Topics.CREDENTIAL_DELETED, (event) => {
    const data = event.data as CredentialEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId ?? 'system',
      actorType: data.userId ? 'user' : 'system',
      action: 'delete',
      resourceType: 'credential',
      resourceId: data.credentialId,
    });
  }, { name: 'audit-log.handler.credential_deleted' });

  // Billing / subscriptions
  eventBus.subscribe(Topics.SUBSCRIPTION_CREATED, (event) => {
    const data = event.data as BillingEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: 'system',
      actorType: 'system',
      action: 'plan_change',
      resourceType: 'subscription',
      resourceId: data.subscriptionId,
      metadata: { plan: data.plan },
    });
  }, { name: 'audit-log.handler.subscription_created' });

  eventBus.subscribe(Topics.SUBSCRIPTION_UPDATED, (event) => {
    const data = event.data as BillingEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: 'system',
      actorType: 'system',
      action: 'plan_change',
      resourceType: 'subscription',
      resourceId: data.subscriptionId,
      metadata: { plan: data.plan },
    });
  }, { name: 'audit-log.handler.subscription_updated' });

  // Member joined
  eventBus.subscribe(Topics.MEMBER_JOINED, (event) => {
    const data = event.data as MemberEventData;
    auditLogsService.log({
      workspaceId: data.workspaceId,
      actorId: data.userId,
      actorType: 'user',
      action: 'create',
      resourceType: 'member',
      resourceId: data.userId,
    });
  }, { name: 'audit-log.handler.member_joined' });

  logger.info('Audit log event handler initialized');
}
