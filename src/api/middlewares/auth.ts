import { createMiddleware } from 'hono/factory';
import { UnauthorizedError, ForbiddenError } from '../../core/errors';
import { logger } from '../../config/logger';
import { validateApiKey } from '../../infra/auth/api-key';
import { getClerkClient } from '../../infra/auth/clerk';
import { decodeJwtPayload } from '../../infra/auth/jwt';
import { hasPermission } from '../../core/security/rbac';
import type { Role } from '../../core/security/rbac';
import { usersRepo } from '../../modules/users/users.repo';

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);

  // API key auth: Bearer a2a_k_...
  if (token.startsWith('a2a_k_')) {
    try {
      const keyInfo = await validateApiKey(token);
      if (!keyInfo) {
        throw new UnauthorizedError('Invalid or expired API key');
      }
      c.set('callerId', `apikey:${token.slice(0, 12)}...`);
      c.set('callerRole', keyInfo.role);
      c.set('workspaceId', keyInfo.workspaceId);
      logger.debug({ keyName: keyInfo.name }, 'API key authenticated');
      return next();
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      logger.error({ error }, 'API key validation encountered an infrastructure error');
      throw error;
    }
  }

  // JWT auth via Clerk (production) or decode-only fallback (dev)
  const clerk = getClerkClient();
  if (clerk) {
    try {
      const payload = await clerk.verifyToken(token);
      c.set('callerId', payload.sub);
      c.set('callerRole', (payload.metadata as any)?.role ?? 'viewer');
      usersRepo.updateLastSeen(payload.sub).catch(() => {});
      return next();
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'Clerk JWT verification failed');
      throw new UnauthorizedError('Invalid or expired token');
    }
  } else {
    // Dev fallback: decode without verification — INSECURE, dev only
    try {
      const payload = decodeJwtPayload(token);
      const sub = (payload.sub as string) ?? 'dev-user';
      c.set('callerId', sub);
      c.set('callerRole', (payload.role as string) ?? (payload.metadata as any)?.role ?? 'viewer');
      logger.debug({ sub }, 'Dev-mode JWT auth (no verification)');
      usersRepo.updateLastSeen(sub).catch(() => {});
      return next();
    } catch {
      throw new UnauthorizedError('Invalid token format');
    }
  }
});

/** Middleware factory: require caller to have at least the given role. Must run after authMiddleware. */
export const requireRole = (minimumRole: Role) =>
  createMiddleware(async (c, next) => {
    const callerRole = c.get('callerRole') as string | undefined;
    if (!callerRole || !hasPermission(callerRole, minimumRole)) {
      throw new ForbiddenError(`Requires '${minimumRole}' role`);
    }
    return next();
  });
