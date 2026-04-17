import type { OAuthProvider, DeviceCodeResponse, PollResult } from '../types';

const CLIENT_ID = 'kilo-vscode-extension';
const DEVICE_CODE_URL = 'https://auth.kilo.ai/device/code';
const TOKEN_URL = 'https://auth.kilo.ai/oauth/token';
const SCOPE = 'openid profile email offline_access';

function extractEmailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded['email'] === 'string' ? decoded['email'] : undefined;
  } catch {
    return undefined;
  }
}

export const kilocodeProvider: OAuthProvider = {
  id: 'kilocode',
  displayName: 'Kilocode',
  flowType: 'device_code',
  supportsRefresh: false,

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
    });
    if (!res.ok) throw new Error(`Kilocode device code request failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      deviceCode: data['device_code'] as string,
      userCode: data['user_code'] as string,
      verificationUrl: data['verification_uri'] as string,
      interval: (data['interval'] as number) ?? 5,
      expiresIn: data['expires_in'] as number,
    };
  },

  async pollToken(deviceCode: string): Promise<PollResult> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: CLIENT_ID,
      }),
    });

    if (res.status === 202) return { success: false, pending: true };
    if (res.status === 403) return { success: false, error: 'access_denied' };
    if (res.status === 410) return { success: false, error: 'expired_token' };
    if (!res.ok) return { success: false, error: 'request_failed' };

    const data = await res.json() as Record<string, unknown>;

    const idToken = data['id_token'] as string | undefined;
    const email = idToken ? extractEmailFromIdToken(idToken) : undefined;

    return {
      success: true,
      tokens: {
        accessToken: data['access_token'] as string,
        expiresIn: data['expires_in'] as number | undefined,
        scope: data['scope'] as string | undefined,
        email,
      },
    };
  },
};
