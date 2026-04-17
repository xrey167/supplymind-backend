import type { OAuthProvider, DeviceCodeResponse, PollResult, TokenSet } from '../types';

const OIDC_BASE = 'https://oidc.us-east-1.amazonaws.com';
const START_URL = 'https://view.awsapps.com/start';
const REGION = 'us-east-1';
const SCOPES = ['openid', 'profile', 'email', 'sso:account:access'];

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function decodeIdTokenEmail(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    return typeof decoded['email'] === 'string' ? decoded['email'] : undefined;
  } catch {
    return undefined;
  }
}

export const kiroProvider: OAuthProvider = {
  id: 'kiro',
  displayName: 'Kiro (AWS Builder ID)',
  flowType: 'device_code',
  supportsRefresh: true,

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const regRes = await fetch(`${OIDC_BASE}/client/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'kiro',
        clientType: 'public',
        scopes: SCOPES,
      }),
    });
    if (!regRes.ok) throw new Error(`Kiro client registration failed: ${await regRes.text()}`);
    const reg = await regRes.json() as Record<string, unknown>;
    const clientId = reg['clientId'] as string;
    const clientSecret = reg['clientSecret'] as string;

    const authBody = new URLSearchParams({ startUrl: START_URL, region: REGION });
    const authRes = await fetch(`${OIDC_BASE}/device_authorization`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: authBody.toString(),
    });
    if (!authRes.ok) throw new Error(`Kiro device authorization failed: ${await authRes.text()}`);
    const auth = await authRes.json() as Record<string, unknown>;

    return {
      deviceCode: auth['deviceCode'] as string,
      userCode: auth['userCode'] as string,
      verificationUrl: auth['verificationUri'] as string,
      interval: (auth['interval'] as number) ?? 5,
      expiresIn: auth['expiresIn'] as number,
      extraData: { clientId, clientSecret },
    };
  },

  async pollToken(deviceCode: string, extraData?: Record<string, unknown>): Promise<PollResult> {
    const clientId = extraData?.['clientId'] as string;
    const clientSecret = extraData?.['clientSecret'] as string;

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode,
      clientId,
    });

    const res = await fetch(`${OIDC_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    // AWS OIDC returns 4xx with JSON error body on pending/slow_down
    if (!res.ok) {
      let data: Record<string, unknown>;
      try {
        data = await res.json() as Record<string, unknown>;
      } catch {
        return { success: false, error: 'request_failed' };
      }
      const error = data['error'] as string | undefined;
      if (error === 'authorization_pending' || error === 'slow_down') {
        return { success: false, pending: true, error };
      }
      return { success: false, error: error ?? 'request_failed', errorDescription: data['error_description'] as string | undefined };
    }

    const data = await res.json() as Record<string, unknown>;

    const tokens: TokenSet = {
      accessToken: data['access_token'] as string,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresIn: data['expires_in'] as number | undefined,
      providerData: { clientId, clientSecret },
    };

    const idToken = data['id_token'] as string | undefined;
    if (idToken) {
      tokens.email = decodeIdTokenEmail(idToken);
    }

    return { success: true, tokens };
  },

  async refreshAccessToken({ refreshToken, providerData }): Promise<TokenSet> {
    const clientId = providerData?.['clientId'] as string;
    const clientSecret = providerData?.['clientSecret'] as string;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      clientId,
    });

    const res = await fetch(`${OIDC_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`Kiro token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;

    const tokens: TokenSet = {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
      providerData: { clientId, clientSecret },
    };

    const idToken = data['id_token'] as string | undefined;
    if (idToken) {
      tokens.email = decodeIdTokenEmail(idToken);
    }

    return tokens;
  },
};
