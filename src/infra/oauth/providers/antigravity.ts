import type { OAuthProvider, TokenSet } from '../types';

const CLIENT_ID = Bun.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = Bun.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? '';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

const CLOUDCODE_ONBOARD_URL = 'https://cloudcode-pa.googleapis.com/v1/workspaces/onboard';
const ONBOARD_POLL_MAX = 10;
const ONBOARD_POLL_INTERVAL_MS = 5_000;

function extractEmailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>;
    return typeof decoded['email'] === 'string' ? decoded['email'] : undefined;
  } catch {
    return undefined;
  }
}

/** Extract projectId from a Cloud Code onboard response body. */
function extractProjectId(body: Record<string, unknown>): string | undefined {
  // Prefer metadata.projectId, fall back to parsing `name` field
  // (name is typically "projects/{projectId}/workspaces/{id}")
  const metadata = body['metadata'] as Record<string, unknown> | undefined;
  if (typeof metadata?.['projectId'] === 'string') return metadata['projectId'];

  const response = body['response'] as Record<string, unknown> | undefined;
  if (typeof response?.['name'] === 'string') {
    const parts = (response['name'] as string).split('/');
    const idx = parts.indexOf('projects');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  }

  if (typeof body['name'] === 'string') {
    const parts = (body['name'] as string).split('/');
    const idx = parts.indexOf('projects');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  }

  return undefined;
}

/** Returns true when the operation is still in-progress (not yet done). */
function isOnboarding(status: number, body: Record<string, unknown>): boolean {
  if (status === 202) return true;
  if (body['done'] === false) return true;
  return false;
}

async function onboardCloudCode(
  accessToken: string,
): Promise<string | undefined> {
  try {
    // Step 1 — trigger onboarding
    const initRes = await fetch(CLOUDCODE_ONBOARD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const initBody = (await initRes.json()) as Record<string, unknown>;

    // If completed synchronously (200 + done !== false), extract and return
    if (!isOnboarding(initRes.status, initBody)) {
      return extractProjectId(initBody);
    }

    // Step 2 — poll until done or max attempts reached
    for (let attempt = 0; attempt < ONBOARD_POLL_MAX; attempt++) {
      await Bun.sleep(ONBOARD_POLL_INTERVAL_MS);

      const pollRes = await fetch(CLOUDCODE_ONBOARD_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const pollBody = (await pollRes.json()) as Record<string, unknown>;

      if (!isOnboarding(pollRes.status, pollBody)) {
        return extractProjectId(pollBody);
      }
    }

    console.warn(
      '[antigravity] Cloud Code onboarding did not complete after %d polls — proceeding without projectId',
      ONBOARD_POLL_MAX,
    );
    return undefined;
  } catch (err) {
    console.warn('[antigravity] Cloud Code onboarding error (non-fatal):', err);
    return undefined;
  }
}

export const antigravityProvider: OAuthProvider = {
  id: 'antigravity',
  displayName: 'Antigravity (Google Cloud Code)',
  flowType: 'authorization_code_pkce',
  supportsRefresh: true,

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

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<TokenSet> {
    // 1. Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
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
    if (!tokenRes.ok) {
      throw new Error(`Antigravity token exchange failed: ${await tokenRes.text()}`);
    }
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;

    const accessToken = tokenData['access_token'] as string;
    const refreshToken = tokenData['refresh_token'] as string | undefined;
    const expiresIn = tokenData['expires_in'] as number | undefined;
    const idToken = tokenData['id_token'] as string | undefined;

    // 2. Extract email from idToken JWT payload
    const email = idToken ? extractEmailFromIdToken(idToken) : undefined;

    // 3 & 4. Onboard with Cloud Code; poll until done (non-fatal)
    const projectId = await onboardCloudCode(accessToken);

    // 5. Return TokenSet
    return {
      accessToken,
      refreshToken,
      expiresIn,
      email,
      providerData: {
        projectId,
        email,
      },
    };
  },

  async refreshAccessToken({ refreshToken }): Promise<TokenSet> {
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
    if (!res.ok) {
      throw new Error(`Antigravity token refresh failed: ${await res.text()}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },
};
