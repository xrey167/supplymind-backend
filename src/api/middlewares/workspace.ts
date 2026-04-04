import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';

// Extract workspace ID from route params or header
export const workspaceMiddleware = createMiddleware(async (c, next) => {
  const workspaceId = c.req.param('workspaceId') ?? c.req.header('X-Workspace-Id');
  if (!workspaceId) {
    throw new ForbiddenError('Missing workspace context');
  }
  c.set('workspaceId', workspaceId);
  // TODO: verify membership once workspace/members modules are implemented
  return next();
});
