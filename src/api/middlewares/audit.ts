import { createMiddleware } from 'hono/factory';
import { eventBus } from '../../events/bus';
import { logger } from '../../config/logger';

/**
 * Audit middleware — logs all API requests with workspace/caller context.
 *
 * Publishes audit events to EventBus for downstream consumers
 * (logging, compliance, analytics). Non-blocking: errors are swallowed.
 */
export const auditMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const durationMs = Date.now() - start;
  const status = c.res.status;
  const callerId = c.get('callerId') as string | undefined;
  const workspaceId = c.get('workspaceId') as string | undefined;

  const entry = {
    method,
    path,
    status,
    durationMs,
    callerId: callerId ?? 'anonymous',
    workspaceId: workspaceId ?? 'none',
    timestamp: new Date().toISOString(),
    userAgent: c.req.header('user-agent'),
  };

  // Fire-and-forget: never block the response
  eventBus.publish('audit.request', entry).catch(() => {});

  if (status >= 400) {
    logger.warn(entry, `${method} ${path} → ${status} (${durationMs}ms)`);
  }
});
