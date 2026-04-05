import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys } from '../db/schema';
import type { Role } from '../../core/security';
import { logger } from '../../config/logger';

export interface ApiKeyInfo {
  id: string;
  workspaceId: string;
  name: string;
  role: Role;
}

/** Hash an API key for storage (SHA-256) */
export async function hashApiKey(key: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(key);
  return hash.digest('hex');
}

/** Validate an API key token against the database. Returns key info or null. */
export async function validateApiKey(token: string): Promise<ApiKeyInfo | null> {
  const prefix = token.slice(0, 12);
  const keyHash = await hashApiKey(token);

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.keyPrefix, prefix), eq(apiKeys.enabled, true)));

  const row = rows[0];
  if (!row) return null;

  // Check expiration
  if (row.expiresAt && row.expiresAt < new Date()) return null;

  // Update last used timestamp (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((error: unknown) => { logger.warn({ keyId: row.id, error }, 'Failed to update API key lastUsedAt'); });

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    role: row.role as Role,
  };
}

/** Create a new API key and return the raw token (only returned once). */
export async function createApiKey(input: {
  workspaceId: string;
  name: string;
  role?: Role;
  expiresAt?: Date;
}): Promise<{ token: string; keyInfo: ApiKeyInfo }> {
  // Generate a secure random token
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const token = `a2a_k_${hex}`;

  const prefix = token.slice(0, 12);
  const keyHash = await hashApiKey(token);

  const rows = await db
    .insert(apiKeys)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      keyHash,
      keyPrefix: prefix,
      role: input.role ?? 'admin',
      expiresAt: input.expiresAt,
    })
    .returning();

  const row = rows[0];
  return {
    token, // only returned at creation time
    keyInfo: {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      role: row.role as Role,
    },
  };
}
