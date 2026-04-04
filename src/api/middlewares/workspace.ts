import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { logger } from '../../config/logger';

export const workspaceMiddleware = createMiddleware(async (c, next) => {
  const workspaceId = c.req.param('workspaceId') ?? c.req.header('X-Workspace-Id');
  if (!workspaceId) {
    throw new ForbiddenError('Missing workspace context');
  }

  // Set workspace context for downstream handlers
  c.set('workspaceId', workspaceId);

  // Membership verification — check if caller belongs to this workspace
  const callerId = c.get('callerId') as string | undefined;
  if (callerId?.startsWith('apikey:')) {
    // API keys bypass membership check (they're workspace-scoped by design)
    return next();
  }

  // TODO: Once workspace_members table is available, verify membership:
  // const isMember = await db.select().from(workspaceMembers)
  //   .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, callerId)))
  //   .limit(1);
  // if (!isMember.length) throw new ForbiddenError('Not a member of this workspace');

  logger.debug({ workspaceId, callerId }, 'Workspace context set (membership check pending)');
  return next();
});
