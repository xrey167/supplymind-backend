import type { OAuthProvider } from '../types';

const CLIENT_ID = Bun.env.OPENAI_OAUTH_CLIENT_ID ?? 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPE = 'openid profile email offline_access';

export const openaiProvider: OAuthProvider = {
  id: 'openai',
  displayName: 'OpenAI',
  flowType: 'authorization_code_pkce',

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI token exchange failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },

  async refreshAccessToken({ refreshToken }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },
};
