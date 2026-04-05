import type { Role } from '../security';
import { validateApiKey } from '../../infra/auth/api-key';
import { logger } from '../../config/logger';

export interface ResolvedIdentity {
  callerId: string;
  workspaceId: string;
  callerRole: Role;
}

/**
 * Resolve a bearer token or API key into a platform identity.
 * Shared by all protocol adapters (WS, MCP, SSE, A2A).
 */
export async function resolveAuth(token: string): Promise<ResolvedIdentity | null> {
  // API key path: a2a_k_...
  if (token.startsWith('a2a_k_')) {
    const keyInfo = await validateApiKey(token).catch((err) => {
      logger.error({ err }, 'API key validation threw');
      return null;
    });
    if (!keyInfo) return null;
    return {
      callerId: `apikey:${token.slice(0, 12)}...`,
      workspaceId: keyInfo.workspaceId,
      callerRole: keyInfo.role,
    };
  }

  // JWT path — try Clerk, fall back to dev decode
  try {
    const clerkSecretKey = Bun.env.CLERK_SECRET_KEY;
    if (clerkSecretKey) {
      const { createClerkClient } = await import('@clerk/backend');
      const clerk = createClerkClient({ secretKey: clerkSecretKey });
      const payload = await clerk.verifyToken(token);
      return {
        callerId: payload.sub,
        workspaceId: (payload as any).metadata?.workspaceId ?? '',
        callerRole: ((payload as any).metadata?.role ?? 'viewer') as Role,
      };
    }

    // Dev fallback: decode without verification
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return {
      callerId: payload.sub ?? 'dev-user',
      workspaceId: payload.workspaceId ?? payload.metadata?.workspaceId ?? '',
      callerRole: (payload.role ?? payload.metadata?.role ?? 'viewer') as Role,
    };
  } catch {
    return null;
  }
}
