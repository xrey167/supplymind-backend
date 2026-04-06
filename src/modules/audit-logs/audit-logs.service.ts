import { logger } from '../../config/logger';
import { auditLogsRepo } from './audit-logs.repo';
import type { AuditLog, CreateAuditLogInput, AuditLogFilter } from './audit-logs.types';

export class AuditLogsService {
  /**
   * Fire-and-forget audit log creation.
   * Safe to call from anywhere — never throws, never blocks the caller.
   */
  log(input: CreateAuditLogInput): void {
    auditLogsRepo.create(input).catch((err) => {
      logger.error({ err, input }, 'Failed to write audit log');
    });
  }

  async list(filter: AuditLogFilter): Promise<AuditLog[]> {
    return auditLogsRepo.list(filter);
  }

  async count(filter: AuditLogFilter): Promise<number> {
    return auditLogsRepo.count(filter);
  }
}

export const auditLogsService = new AuditLogsService();
