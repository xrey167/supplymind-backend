import { AuthError } from '../sync/sync-errors';

export interface TokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface BcToken {
  accessToken: string;
  expiresAt: number;
}

async function fetchToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<BcToken> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://api.businesscentral.dynamics.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AuthError(`Azure AD token request failed (${res.status}): ${text}`);
  }

  const json = await res.json() as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
}

export async function getToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  cache: TokenCache,
  forceRefresh = false,
): Promise<string> {
  const cacheKey = `bc:token:${tenantId}:${clientId}`;

  if (!forceRefresh) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      try {
        const token = JSON.parse(cached) as BcToken;
        if (token.expiresAt > Date.now()) return token.accessToken;
      } catch { /* ignore malformed cache */ }
    }
  }

  const token = await fetchToken(tenantId, clientId, clientSecret);
  await cache.set(cacheKey, JSON.stringify(token), Math.max(token.expiresAt - Date.now(), 1000));
  return token.accessToken;
}
