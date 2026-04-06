import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { mapWorkspaceRole, isKnownWorkspaceRole } from '../../core/security/rbac';
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

  c.set('workspaceId', workspaceId);

  mcpService.ensureWorkspaceLoaded(workspaceId).catch((err) => {
    logger.warn({ err, workspaceId }, 'Failed to lazy-load workspace MCP servers');
  });

  const callerId = c.get('callerId') as string | undefined;
  if (callerId?.startsWith('apikey:')) {
    // API keys already have callerRole set by auth middleware — bypass membership check
    // Soft-delete check will be added in Task 3 when deletedAt column exists
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

    if (!isKnownWorkspaceRole(member.role)) {
      logger.warn({ workspaceRole: member.role, workspaceId, callerId }, 'Unknown workspace role, defaulting to viewer');
    }
    c.set('callerRole', mapWorkspaceRole(member.role));
    c.set('workspaceRole', member.role);
  }

  logger.debug({ workspaceId, callerId }, 'Workspace context set');
  return next();
});
