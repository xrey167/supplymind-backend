import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';

export interface AuditEntry {
  action: string;
  actor: string;
  resource: string;
  resourceId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export function audit(entry: Omit<AuditEntry, 'timestamp'>): void {
  const full: AuditEntry = { ...entry, timestamp: new Date() };
  logger.info({ audit: full }, `audit: ${entry.action}`);
  eventBus.publish('audit.entry', full);
}
