import { logger } from '../../config/logger';
import { getClerkClient } from '../auth/clerk';
import { decodeJwtPayload } from '../auth/jwt';
import { db } from '../db/client';
import { workspaceMembers } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Verify a Bearer token for WebSocket auth handshake.
 * Returns { userId, workspaceIds } on success, throws on failure.
 */
export async function verifyWsToken(token: string): Promise<{ userId: string; workspaceIds: Set<string> }> {
  const userId = await resolveUserId(token);
  const rows = await db.select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const workspaceIds = new Set(rows.map(r => r.workspaceId));
  return { userId, workspaceIds };
}

async function resolveUserId(token: string): Promise<string> {
  const clerk = getClerkClient();
  if (clerk) {
    const payload = await clerk.verifyToken(token);
    return payload.sub;
  }

  // Dev fallback: decode JWT without verification
  logger.warn('WS auth using insecure dev-mode JWT decode — set CLERK_SECRET_KEY for production');
  const payload = decodeJwtPayload(token);
  if (!payload.sub) throw new Error('JWT missing sub claim');
  return payload.sub as string;
}
