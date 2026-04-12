import { logger } from '../../config/logger';

type ClerkClient = { verifyToken: (token: string) => Promise<{ sub: string; metadata?: Record<string, unknown> }> };

let client: ClerkClient | null = null;
let initialised = false;

/** Lazy-initialised Clerk client singleton. Returns null when CLERK_SECRET_KEY is not set. */
export function getClerkClient(): ClerkClient | null {
  if (initialised) return client;
  initialised = true;

  const secret = Bun.env.CLERK_SECRET_KEY;
  if (!secret) {
    logger.warn('CLERK_SECRET_KEY not set — Clerk client unavailable');
    return null;
  }

  try {
    const { createClerkClient } = require('@clerk/backend') as typeof import('@clerk/backend');
    client = createClerkClient({ secretKey: secret }) as unknown as ClerkClient;
    logger.info('Clerk client initialised');
  } catch (err) {
    logger.warn({ err }, 'Failed to initialise Clerk client');
  }

  return client;
}

/** Verify a Clerk JWT token. Returns { userId, metadata } on success. Throws on failure. */
export async function verifyClerkToken(token: string): Promise<{ userId: string; metadata: Record<string, unknown> }> {
  const clerk = getClerkClient();
  if (!clerk) {
    throw new Error('Clerk client not available — set CLERK_SECRET_KEY');
  }
  const payload = await clerk.verifyToken(token);
  return {
    userId: payload.sub,
    metadata: (payload.metadata as Record<string, unknown>) ?? {},
  };
}

/** Reset singleton state (for testing only). */
export function _resetClerkClient(): void {
  client = null;
  initialised = false;
}
