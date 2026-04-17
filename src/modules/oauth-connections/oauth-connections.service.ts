import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { getProvider } from '../../infra/oauth/registry';
import { oauthConnectionsRepo } from './oauth-connections.repo';
import type { OAuthConnection, OAuthProvider, StoreTokenInput } from './oauth-connections.types';
import { logger } from '../../config/logger';

/** 5-minute buffer: refresh before actual expiry */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export const oauthConnectionsService = {
  /** Returns a valid, decrypted access token for the workspace+provider combo.
   *  Auto-refreshes if within the expiry buffer window.
   *  Returns null if no connection exists. */
  async getActiveToken(workspaceId: string, provider: OAuthProvider): Promise<string | null> {
    const connections = await oauthConnectionsRepo.listForWorkspace(workspaceId, provider);
    const active = connections.find(c => c.status === 'active');
    if (!active) return null;

    // Check if refresh needed
    const needsRefresh = active.expiresAt
      ? active.expiresAt.getTime() - Date.now() < EXPIRY_BUFFER_MS
      : false;

    if (needsRefresh) {
      const refreshed = await this.refreshConnection(active);
      if (!refreshed.ok) {
        logger.warn({ err: refreshed.error, connectionId: active.id }, 'Token refresh failed, returning existing token');
      }
    }

    const { accessToken } = await oauthConnectionsRepo.getDecryptedTokens(active.id);
    return accessToken;
  },

  async storeTokens(input: StoreTokenInput): Promise<Result<OAuthConnection>> {
    try {
      const conn = await oauthConnectionsRepo.upsert(input);
      return ok(conn);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  },

  async refreshConnection(connection: OAuthConnection): Promise<Result<OAuthConnection>> {
    try {
      const provider = getProvider(connection.provider);
      if (provider.supportsRefresh === false) {
        await oauthConnectionsRepo.updateStatus(connection.id, 'expired', 'Provider does not support token refresh');
        return err(new Error(`Provider ${connection.provider} does not support token refresh`));
      }
      if (!provider.refreshAccessToken) {
        return err(new Error(`Provider ${connection.provider} does not support token refresh`));
      }
      const { refreshToken } = await oauthConnectionsRepo.getDecryptedTokens(connection.id);
      if (!refreshToken) {
        return err(new Error(`No refresh token available for connection ${connection.id}`));
      }
      const tokens = await provider.refreshAccessToken({ refreshToken, providerData: connection.providerData });
      const updated = await oauthConnectionsRepo.upsert({
        workspaceId: connection.workspaceId,
        provider: connection.provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? refreshToken,
        expiresIn: tokens.expiresIn,
        email: connection.email ?? undefined,
        scope: tokens.scope ?? connection.scope ?? undefined,
        providerData: connection.providerData,
      });
      return ok(updated);
    } catch (error) {
      await oauthConnectionsRepo.updateStatus(
        connection.id,
        'error',
        error instanceof Error ? error.message : String(error),
      );
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  },

  async disconnect(id: string): Promise<boolean> {
    return oauthConnectionsRepo.delete(id);
  },

  async listConnections(workspaceId: string): Promise<OAuthConnection[]> {
    return oauthConnectionsRepo.listForWorkspace(workspaceId);
  },

  async refreshExpiringSoon(windowMs = 15 * 60 * 1000): Promise<void> {
    const expiring = await oauthConnectionsRepo.listExpiringSoon(windowMs);
    for (const conn of expiring) {
      const provider = getProvider(conn.provider);
      if (provider.supportsRefresh === false) continue;
      const result = await this.refreshConnection(conn);
      if (!result.ok) {
        logger.warn({ err: result.error, connectionId: conn.id, provider: conn.provider }, 'Proactive token refresh failed');
      }
    }
  },
};
