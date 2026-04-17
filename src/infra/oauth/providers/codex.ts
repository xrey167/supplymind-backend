import type { OAuthProvider, TokenSet } from '../types';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPES = 'openid email profile offline_access';

interface OpenAIOrganization {
  id: string;
  name: string;
  is_default: boolean;
  plan_type: string;
}

interface OpenAIAuthClaim {
  user_id: string;
  organizations: OpenAIOrganization[];
}

interface OpenAIIdTokenPayload {
  email?: string;
  name?: string;
  'https://api.openai.com/auth'?: OpenAIAuthClaim;
}

function decodeIdTokenPayload(idToken: string): OpenAIIdTokenPayload {
  const segment = idToken.split('.')[1];
  if (!segment) throw new Error('Codex: malformed id_token — missing payload segment');
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as OpenAIIdTokenPayload;
}

export const codexProvider: OAuthProvider = {
  id: 'codex',
  displayName: 'OpenAI Codex',
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
      id_token_add_organizations: 'true',
    });
    return `${AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<TokenSet> {
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
    if (!res.ok) throw new Error(`Codex token exchange failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;

    const idToken = data['id_token'] as string | undefined;
    let email: string | undefined;
    let displayName: string | undefined;
    let providerData: Record<string, unknown> | undefined;

    if (idToken) {
      const payload = decodeIdTokenPayload(idToken);
      email = payload.email;
      displayName = payload.name;

      const authClaim = payload['https://api.openai.com/auth'];
      if (authClaim) {
        const orgs = authClaim.organizations ?? [];
        const defaultOrg = orgs.find((o) => o.is_default) ?? orgs.find((o) => o.plan_type === 'team');
        const org = defaultOrg ?? orgs[0];
        providerData = {
          workspaceId: org?.id,
          workspacePlanType: org?.plan_type,
          chatgptUserId: authClaim.user_id,
          organizations: orgs,
        };
      }
    }

    return {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
      scope: data['scope'] as string | undefined,
      email,
      displayName,
      providerData,
    };
  },

  async refreshAccessToken({ refreshToken }): Promise<TokenSet> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Codex token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
    };
  },
};
