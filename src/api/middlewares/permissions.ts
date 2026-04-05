import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { hasPermission } from '../../core/security/rbac';
import type { Role } from '../../core/security/rbac';

/**
 * Resource-level permission middleware factory.
 *
 * Goes beyond role checks (which `requireRole` handles) to enforce
 * resource-specific access rules. Uses workspace-scoped policies.
 *
 * @param resource — resource type (e.g., 'api-keys', 'agents', 'settings')
 * @param action — action (e.g., 'read', 'write', 'delete', 'admin')
 */
export function requirePermission(resource: string, action: string) {
  return createMiddleware(async (c, next) => {
    const callerRole = c.get('callerRole') as Role | undefined;
    if (!callerRole) throw new ForbiddenError('No role assigned');

    // Map resource+action to minimum required role
    const requiredRole = getRequiredRoleForAction(resource, action);
    if (!hasPermission(callerRole, requiredRole)) {
      throw new ForbiddenError(`Permission denied: ${resource}:${action} requires '${requiredRole}'`);
    }

    return next();
  });
}

/**
 * Default resource→role mapping.
 * Override per workspace via scoped config in the future.
 */
function getRequiredRoleForAction(resource: string, action: string): Role {
  // Admin-only resources
  if (resource === 'api-keys' || resource === 'settings') {
    return 'admin';
  }

  // Write operations require at least operator
  if (action === 'write' || action === 'delete') {
    return 'operator';
  }

  // Admin actions always need admin
  if (action === 'admin') {
    return 'admin';
  }

  // Read is the most permissive
  return 'viewer';
}
