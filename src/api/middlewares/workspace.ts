import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { mapWorkspaceRole } from '../../core/security/rbac';
import { logger } from '../../config/logger';
import { mcpService } from '../../modules/mcp/mcp.service';
import { db } from '../../infra/db/client';
import { workspaceMembers, workspaces } from '../../infra/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

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
    // API keys are workspace-scoped — but must check workspace not soft-deleted
    const [ws] = await db.select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!ws) {
      throw new ForbiddenError('Workspace not found or deleted');
    }
    return next();
  }

  if (callerId) {
    const [member] = await db.select({
      role: workspaceMembers.role,
      deletedAt: workspaces.deletedAt,
    })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, callerId),
      ))
      .limit(1);

    if (!member || member.deletedAt !== null) {
      throw new ForbiddenError(member?.deletedAt ? 'Workspace has been deleted' : 'Not a member of this workspace');
    }

    c.set('callerRole', mapWorkspaceRole(member.role));
    c.set('workspaceRole', member.role);
  }

  logger.debug({ workspaceId, callerId }, 'Workspace context set');
  return next();
});
