import { logger } from '../../config/logger';
import { auditLogsRepo } from './audit-logs.repo';
import type { AuditLog, AuditStats, CreateAuditLogInput, AuditLogFilter } from './audit-logs.types';

export class AuditLogsService {
  /**
   * Fire-and-forget audit log creation.
   * Safe to call from anywhere — never throws, never blocks the caller.
   */
  log(input: CreateAuditLogInput): void {
    auditLogsRepo.createLog(input).catch((err) => {
      logger.error({ err, input }, 'Failed to write audit log');
    });
  }

  async list(filter: AuditLogFilter): Promise<AuditLog[]> {
    return auditLogsRepo.list(filter);
  }

  async count(filter: AuditLogFilter): Promise<number> {
    return auditLogsRepo.count(filter);
  }

  async stats(workspaceId: string): Promise<AuditStats> {
    return auditLogsRepo.getStats(workspaceId);
  }
}

export const auditLogsService = new AuditLogsService();
