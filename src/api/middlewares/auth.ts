import { createMiddleware } from 'hono/factory';
import { UnauthorizedError } from '../../core/errors';

// Simple API key check (Clerk integration is placeholder for now)
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  // API key auth: Bearer a2a_k_...
  if (authHeader.startsWith('Bearer a2a_k_')) {
    // TODO: validate against api_keys table
    c.set('callerId', 'api-key-user');
    c.set('callerRole', 'admin');
    return next();
  }

  // Clerk JWT auth: Bearer eyJ...
  if (authHeader.startsWith('Bearer ey')) {
    try {
      // TODO: full Clerk verification with @clerk/backend
      // For now, decode JWT payload without verification (dev only)
      const token = authHeader.slice(7);
      const payload = JSON.parse(atob(token.split('.')[1]));
      c.set('callerId', payload.sub ?? 'unknown');
      c.set('callerRole', payload.role ?? 'viewer');
      return next();
    } catch {
      throw new UnauthorizedError('Invalid JWT token');
    }
  }

  throw new UnauthorizedError('Invalid Authorization format');
});
