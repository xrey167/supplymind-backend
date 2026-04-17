import type { OAuthProvider, DeviceCodeResponse, PollResult } from '../types';

const CLIENT_ID = Bun.env.GITHUB_OAUTH_CLIENT_ID ?? 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_INFO_URL = 'https://api.github.com/user';
const SCOPES = 'read:user';

export const githubProvider: OAuthProvider = {
  id: 'github',
  displayName: 'GitHub Copilot',
  flowType: 'device_code',

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
    });
    if (!res.ok) throw new Error(`GitHub device code request failed: ${await res.text()}`);
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
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!res.ok) return { success: false, error: 'request_failed' };
    const data = await res.json() as Record<string, unknown>;

    if (data['error']) {
      const error = data['error'] as string;
      if (error === 'authorization_pending' || error === 'slow_down') {
        return { success: false, pending: true, error };
      }
      return { success: false, error, errorDescription: data['error_description'] as string };
    }

    if (!data['access_token']) return { success: false, error: 'no_access_token' };

    // Fetch user email
    let email: string | undefined;
    try {
      const userRes = await fetch(USER_INFO_URL, {
        headers: { Authorization: `token ${data['access_token']}`, 'User-Agent': 'SupplyMindAI/1.0' },
      });
      if (userRes.ok) {
        const user = await userRes.json() as Record<string, unknown>;
        email = user['email'] as string | undefined;
      }
    } catch { /* non-fatal */ }

    return {
      success: true,
      tokens: {
        accessToken: data['access_token'] as string,
        refreshToken: data['refresh_token'] as string | undefined,
        expiresIn: data['expires_in'] as number | undefined,
        email,
      },
    };
  },
};
