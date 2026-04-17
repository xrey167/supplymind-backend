import { eq, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { oauthConnections } from '../../infra/db/schema';
import { encryptToken, decryptToken } from '../../infra/oauth/token-encrypt';
import type { OAuthConnection, StoreTokenInput } from './oauth-connections.types';

/**
 * Sentinel email for providers that don't return an email (e.g. token_import providers).
 * PostgreSQL treats NULL != NULL in unique indexes, so a sentinel ensures the
 * UNIQUE(workspace_id, provider, email) constraint still prevents duplicate connections.
 * Translated back to null in toPublic().
 */
const NO_EMAIL_SENTINEL = '__imported__';

function toPublic(row: typeof oauthConnections.$inferSelect): OAuthConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as OAuthConnection['provider'],
    email: row.email === NO_EMAIL_SENTINEL ? null : row.email,
    displayName: row.displayName,
    scope: row.scope,
    status: row.status as OAuthConnection['status'],
    lastError: row.lastError,
    lastRefreshedAt: row.lastRefreshedAt,
    expiresAt: row.expiresAt,
    providerData: (row.providerData ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

export const oauthConnectionsRepo = {
  async upsert(input: StoreTokenInput): Promise<OAuthConnection> {
    const { encrypted: ea, iv: ia, tag: ta } = encryptToken(input.accessToken, input.workspaceId);

    let encRt: string | undefined, ivRt: string | undefined, tagRt: string | undefined;
    if (input.refreshToken) {
      const rt = encryptToken(input.refreshToken, input.workspaceId);
      encRt = rt.encrypted; ivRt = rt.iv; tagRt = rt.tag;
    }

    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null;

    const values = {
      workspaceId: input.workspaceId,
      provider: input.provider as typeof oauthConnections.$inferInsert['provider'],
      email: input.email ?? NO_EMAIL_SENTINEL,
      displayName: input.displayName ?? null,
      encryptedAccessToken: ea,
      accessTokenIv: ia,
      accessTokenTag: ta,
      encryptedRefreshToken: encRt ?? null,
      refreshTokenIv: ivRt ?? null,
      refreshTokenTag: tagRt ?? null,
      expiresAt,
      scope: input.scope ?? null,
      status: 'active' as const,
      lastError: null,
      lastRefreshedAt: new Date(),
      providerData: (input.providerData ?? {}) as Record<string, unknown>,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(oauthConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [oauthConnections.workspaceId, oauthConnections.provider, oauthConnections.email],
        set: values,
      })
      .returning();

    return toPublic(row);
  },

  async listForWorkspace(workspaceId: string, provider?: string): Promise<OAuthConnection[]> {
    const conditions = [eq(oauthConnections.workspaceId, workspaceId)];
    if (provider) {
      conditions.push(eq(oauthConnections.provider, provider as typeof oauthConnections.$inferInsert['provider']));
    }
    const rows = await db.select().from(oauthConnections).where(and(...conditions));
    return rows.map(toPublic);
  },

  async getById(id: string): Promise<OAuthConnection | null> {
    const [row] = await db.select().from(oauthConnections).where(eq(oauthConnections.id, id));
    return row ? toPublic(row) : null;
  },

  async getDecryptedTokens(id: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const [row] = await db.select().from(oauthConnections).where(eq(oauthConnections.id, id));
    if (!row) throw new Error(`OAuthConnection not found: ${id}`);
    const accessToken = decryptToken(row.encryptedAccessToken, row.accessTokenIv, row.accessTokenTag, row.workspaceId);
    let refreshToken: string | undefined;
    if (row.encryptedRefreshToken && row.refreshTokenIv && row.refreshTokenTag) {
      refreshToken = decryptToken(row.encryptedRefreshToken, row.refreshTokenIv, row.refreshTokenTag, row.workspaceId);
    }
    return { accessToken, refreshToken };
  },

  async updateStatus(id: string, status: OAuthConnection['status'], lastError?: string): Promise<void> {
    await db.update(oauthConnections)
      .set({ status, lastError: lastError ?? null, updatedAt: new Date() })
      .where(eq(oauthConnections.id, id));
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(oauthConnections).where(eq(oauthConnections.id, id));
    return (result.rowCount ?? 0) > 0;
  },

  async listExpiringSoon(windowMs: number): Promise<OAuthConnection[]> {
    const cutoff = new Date(Date.now() + windowMs);
    const rows = await db.select().from(oauthConnections)
      .where(eq(oauthConnections.status, 'active'));
    // Filter in JS — fine for background job frequency
    return rows.filter(r => r.expiresAt && r.expiresAt <= cutoff).map(toPublic);
  },
};
