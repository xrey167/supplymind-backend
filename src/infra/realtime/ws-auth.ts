import { logger } from '../../config/logger';

/**
 * Verify a Bearer token for WebSocket auth handshake.
 * Reuses the same Clerk client logic as the HTTP auth middleware.
 * Returns the userId (sub) on success, throws on failure.
 */
export async function verifyWsToken(token: string): Promise<string> {
  const clerkSecretKey = Bun.env.CLERK_SECRET_KEY;
  if (clerkSecretKey) {
    const { createClerkClient } = await import('@clerk/backend');
    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    const payload = await clerk.verifyToken(token);
    return payload.sub;
  }

  // Dev fallback: decode JWT without verification (insecure, matches auth middleware behaviour)
  logger.warn('WS auth using insecure dev-mode JWT decode — set CLERK_SECRET_KEY for production');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
  if (!payload.sub) throw new Error('JWT missing sub claim');
  return payload.sub as string;
}
