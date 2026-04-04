import { createMiddleware } from 'hono/factory';
import { UnauthorizedError, ForbiddenError } from '../../core/errors';
import { logger } from '../../config/logger';
import { validateApiKey } from '../../infra/auth/api-key';
import { hasPermission } from '../../core/security/rbac';
import type { Role } from '../../core/security/rbac';

// Try to initialise Clerk client — graceful fallback if secret key is absent
let clerkClient: any = null;
try {
  const clerkSecretKey = Bun.env.CLERK_SECRET_KEY;
  if (clerkSecretKey) {
    const { createClerkClient } = await import('@clerk/backend');
    clerkClient = createClerkClient({ secretKey: clerkSecretKey });
    logger.info('Clerk client initialised');
  } else {
    logger.warn('CLERK_SECRET_KEY not set — falling back to dev-mode JWT parsing (INSECURE)');
  }
} catch (err) {
  logger.warn({ err }, 'Failed to initialise Clerk client — falling back to dev-mode JWT parsing (INSECURE)');
}

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
      // DB unavailable — fall back to stub validation in dev only
      if (!Bun.env.CLERK_SECRET_KEY) {
        logger.warn('API key DB validation failed — falling back to stub (dev only)');
        c.set('callerId', `apikey:${token.slice(0, 12)}...`);
        c.set('callerRole', 'admin');
        return next();
      }
      throw new UnauthorizedError('API key validation failed');
    }
  }

  // JWT auth via Clerk (production) or decode-only fallback (dev)
  if (clerkClient) {
    // Production: cryptographically verify with Clerk
    try {
      const payload = await clerkClient.verifyToken(token);
      c.set('callerId', payload.sub);
      c.set('callerRole', (payload.metadata as any)?.role ?? 'viewer');
      return next();
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'Clerk JWT verification failed');
      throw new UnauthorizedError('Invalid or expired token');
    }
  } else {
    // Dev fallback: decode without verification — INSECURE, dev only
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Not a JWT');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      c.set('callerId', payload.sub ?? 'dev-user');
      c.set('callerRole', payload.role ?? payload.metadata?.role ?? 'viewer');
      logger.debug({ sub: payload.sub }, 'Dev-mode JWT auth (no verification)');
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
