import type { OAuthProvider, TokenSet } from '../types';

const CLIENT_ID = Bun.env.CLAUDE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = Bun.env.CLAUDE_OAUTH_REDIRECT_URI ?? 'http://localhost:3001/api/oauth/claude/callback';
const SCOPES = ['org:create_api_key', 'user:profile', 'user:inference'].join(' ');

export const claudeProvider: OAuthProvider = {
  id: 'claude',
  displayName: 'Claude (Anthropic)',
  flowType: 'authorization_code_pkce',

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri ?? REDIRECT_URI,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, state }) {
    // Claude code may contain state after '#'
    let authCode = code;
    let codeState = state ?? '';
    if (code.includes('#')) {
      const [c, s] = code.split('#');
      authCode = c;
      codeState = s ?? state ?? '';
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: authCode,
        redirect_uri: redirectUri ?? REDIRECT_URI,
        code_verifier: codeVerifier,
        state: codeState,
      }),
    });
    if (!res.ok) throw new Error(`Claude token exchange failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
      scope: data['scope'] as string | undefined,
    };
  },

  async refreshAccessToken({ refreshToken }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Claude token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },
};
