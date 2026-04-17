import type { OAuthProvider } from '../types';

const CLIENT_ID = Bun.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = Bun.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export const googleProvider: OAuthProvider = {
  id: 'google',
  displayName: 'Google (Gemini)',
  flowType: 'authorization_code_pkce',

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
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
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    // Fetch user email
    let email: string | undefined;
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
        headers: { Authorization: `Bearer ${data['access_token']}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as Record<string, unknown>;
        email = info['email'] as string | undefined;
      }
    } catch { /* non-fatal */ }
    return {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
      scope: data['scope'] as string | undefined,
      email,
    };
  },

  async refreshAccessToken({ refreshToken }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },
};
