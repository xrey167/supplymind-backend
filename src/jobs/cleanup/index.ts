import { taskRepo } from '../../infra/a2a/task-repo';
import { sessionsService } from '../../modules/sessions/sessions.service';
import { apiKeysRepo } from '../../modules/api-keys/api-keys.repo';
import { logger } from '../../config/logger';

const STALE_WORKING_MS = 30 * 60 * 1000;
const STALE_SUBMITTED_MS = 60 * 60 * 1000;

export async function runCleanup(tr: Pick<typeof taskRepo, 'findStale' | 'updateStatus'> = taskRepo): Promise<void> {
  try {
    const staleTasks = await tr.findStale('working', STALE_WORKING_MS);
    for (const task of staleTasks) {
      try {
        await tr.updateStatus(task.id, 'failed', undefined, undefined);
        logger.info({ taskId: task.id }, 'Cleanup: marked stale working task as failed');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Cleanup: failed to update stale working task');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale working tasks step failed');
  }

  try {
    const staleSubmitted = await tr.findStale('submitted', STALE_SUBMITTED_MS);
    for (const task of staleSubmitted) {
      try {
        await tr.updateStatus(task.id, 'failed', undefined, undefined);
        logger.info({ taskId: task.id }, 'Cleanup: marked stale submitted task as failed');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Cleanup: failed to update stale submitted task');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale submitted tasks step failed');
  }

  try {
    const expired = await sessionsService.expireIdleSessions();
    if (expired > 0) logger.info({ count: expired }, 'Cleanup: expired idle sessions');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expire sessions step failed');
  }

  try {
    const deleted = await apiKeysRepo.deleteExpired();
    if (deleted > 0) logger.info({ count: deleted }, 'Cleanup: deleted expired API keys');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expired API keys step failed');
  }

  // Clean up expired invitations
  try {
    const { invitationsRepo } = await import('../../modules/members/invitations.repo');
    const deleted = await invitationsRepo.deleteExpired();
    if (deleted > 0) logger.info({ count: deleted }, 'Cleanup: deleted expired invitations');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expired invitations step failed');
  }

  // Prune old audit logs (default 90 days, configurable via AUDIT_LOG_RETENTION_DAYS)
  try {
    const raw = Number(process.env.AUDIT_LOG_RETENTION_DAYS);
    const retentionDays = Number.isFinite(raw) && raw > 0 ? raw : 90;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { auditLogsRepo } = await import('../../modules/audit-logs/audit-logs.repo');
    const deleted = await auditLogsRepo.deleteOlderThan(cutoff);
    if (deleted > 0) logger.info({ count: deleted, retentionDays }, 'Cleanup: pruned old audit logs');
  } catch (err) {
    logger.error({ err }, 'Cleanup: audit log retention step failed');
  }

  // Hard-delete soft-deleted workspaces past 30-day grace period
  try {
    const { workspacesRepo } = await import('../../modules/workspaces/workspaces.repo');
    const { eventBus } = await import('../../events/bus');
    const { Topics } = await import('../../events/topics');
    const { db } = await import('../../infra/db/client');
    const schema = await import('../../infra/db/schema');
    const { eq } = await import('drizzle-orm');

    const staleWorkspaces = await workspacesRepo.findSoftDeleted(30);
    for (const ws of staleWorkspaces) {
      try {
        await db.transaction(async (tx) => {
          await tx.delete(schema.usageRecords).where(eq(schema.usageRecords.workspaceId, ws.id));
          await tx.delete(schema.memoryProposals).where(eq(schema.memoryProposals.workspaceId, ws.id));
          await tx.delete(schema.agentMemories).where(eq(schema.agentMemories.workspaceId, ws.id));
          await tx.delete(schema.orchestrations).where(eq(schema.orchestrations.workspaceId, ws.id));
          await tx.delete(schema.a2aTasks).where(eq(schema.a2aTasks.workspaceId, ws.id));
          await tx.delete(schema.sessions).where(eq(schema.sessions.workspaceId, ws.id));
          await tx.delete(schema.agentConfigs).where(eq(schema.agentConfigs.workspaceId, ws.id));
          await tx.delete(schema.workflowTemplates).where(eq(schema.workflowTemplates.workspaceId, ws.id));
          await tx.delete(schema.registeredAgents).where(eq(schema.registeredAgents.workspaceId, ws.id));
          await tx.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, ws.id));
          await tx.delete(schema.skillDefinitions).where(eq(schema.skillDefinitions.workspaceId, ws.id));
          await tx.delete(schema.mcpServerConfigs).where(eq(schema.mcpServerConfigs.workspaceId, ws.id));
          await tx.delete(schema.workspaceInvitations).where(eq(schema.workspaceInvitations.workspaceId, ws.id));
          await tx.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.workspaceId, ws.id));
          await tx.delete(schema.workspaceSettings).where(eq(schema.workspaceSettings.workspaceId, ws.id));
          await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
        });
        eventBus.publish(Topics.WORKSPACE_DELETED, { workspaceId: ws.id });
        logger.info({ workspaceId: ws.id }, 'Cleanup: hard-deleted workspace');
      } catch (err) {
        logger.warn({ workspaceId: ws.id, err }, 'Cleanup: workspace hard-delete failed, will retry next cycle');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: workspace hard-delete step failed');
  }
}
