import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { logger } from '../../config/logger';
import { mcpService } from '../../modules/mcp/mcp.service';
import { db } from '../../infra/db/client';
import { workspaceMembers } from '../../infra/db/schema';
import { and, eq } from 'drizzle-orm';

export const workspaceMiddleware = createMiddleware(async (c, next) => {
  const workspaceId = c.req.param('workspaceId') ?? c.req.header('X-Workspace-Id');
  if (!workspaceId) {
    throw new ForbiddenError('Missing workspace context');
  }

  // Set workspace context for downstream handlers
  c.set('workspaceId', workspaceId);

  // Lazy-load workspace MCP servers (fire-and-forget, idempotent)
  mcpService.ensureWorkspaceLoaded(workspaceId).catch((err) => {
    logger.warn({ err, workspaceId }, 'Failed to lazy-load workspace MCP servers');
  });

  // Membership verification
  const callerId = c.get('callerId') as string | undefined;
  if (callerId?.startsWith('apikey:')) {
    // API keys are workspace-scoped by design — bypass membership check
    return next();
  }

  if (callerId) {
    const [member] = await db.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, callerId),
      ))
      .limit(1);

    if (!member) {
      throw new ForbiddenError('Not a member of this workspace');
    }

    c.set('callerRole', member.role);
  }

  logger.debug({ workspaceId, callerId }, 'Workspace context set');
  return next();
});
