import type { OAuthProvider, TokenSet } from '../types';

const CLIENT_ID = 'cline-vscode';
const AUTHORIZE_URL = 'https://app.cline.bot/oauth/authorize';
const TOKEN_URL = 'https://app.cline.bot/oauth/token';
const SCOPES = 'openid email profile';

export const clineProvider: OAuthProvider = {
  id: 'cline',
  displayName: 'Cline',
  flowType: 'authorization_code_pkce',
  supportsRefresh: false,

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }) {
    try {
      const decoded = JSON.parse(Buffer.from(code, 'base64url').toString('utf-8')) as Record<string, unknown>;
      if (decoded['access_token']) {
        return {
          accessToken: decoded['access_token'] as string,
          refreshToken: decoded['refresh_token'] as string | undefined,
          expiresIn: decoded['expires_in'] as number | undefined,
          scope: decoded['scope'] as string | undefined,
          email: decoded['email'] as string | undefined,
        };
      }
    } catch { /* fall through to HTTP exchange */ }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`Cline token exchange failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
      scope: data['scope'] as string | undefined,
      email: data['email'] as string | undefined,
    } satisfies TokenSet;
  },
};
