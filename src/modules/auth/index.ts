/**
 * Auth module barrel — re-exports from infra/auth and api/middlewares.
 * Auth logic lives in infra/auth/ (Clerk, JWT, API keys) and api/middlewares/auth.ts.
 */
export { getClerkClient, verifyClerkToken } from '../../infra/auth/clerk';
export { decodeJwtPayload, isExpired } from '../../infra/auth/jwt';
export { validateApiKey, createApiKey } from '../../infra/auth/api-key';
export { authMiddleware, requireRole } from '../../api/middlewares/auth';
