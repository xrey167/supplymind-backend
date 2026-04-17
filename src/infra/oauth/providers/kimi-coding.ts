import type { OAuthProvider, DeviceCodeResponse, PollResult, TokenSet } from '../types';

const DEVICE_CODE_URL = 'https://kimi.moonshot.cn/api/device/code';
const TOKEN_URL = 'https://kimi.moonshot.cn/api/device/token';
const REFRESH_URL = 'https://kimi.moonshot.cn/api/device/refresh';

// Stable per-installation device ID. Acceptable for server-side use: one identity
// per backend process, not per user. Regenerates on each cold start, which is
// fine — Kimi uses it as a correlation header, not a persistent credential.
const DEVICE_ID = crypto.randomUUID();

const MSH_HEADERS = {
  'X-Msh-Platform': 'web',
  'X-Msh-Version': '1.0.0',
  'X-Msh-Device-Id': DEVICE_ID,
} as const;

export const kimiCodingProvider: OAuthProvider = {
  id: 'kimi-coding',
  displayName: 'Kimi (Moonshot AI)',
  flowType: 'device_code',
  supportsRefresh: true,

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...MSH_HEADERS,
      },
      body: JSON.stringify({ client_id: 'kimi-code', scope: 'user' }),
    });
    if (!res.ok) throw new Error(`Kimi device code request failed: ${await res.text()}`);
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
    const url = `${TOKEN_URL}?device_code=${encodeURIComponent(deviceCode)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...MSH_HEADERS },
    });

    if (!res.ok) return { success: false, error: 'request_failed' };

    const data = await res.json() as Record<string, unknown>;

    if (data['error']) {
      const error = data['error'] as string;
      if (error === 'authorization_pending') {
        return { success: false, pending: true };
      }
      if (error === 'access_denied') {
        return { success: false, error: 'access_denied' };
      }
      return {
        success: false,
        error,
        errorDescription: data['error_description'] as string | undefined,
      };
    }

    if (!data['access_token']) return { success: false, error: 'no_access_token' };

    return {
      success: true,
      tokens: {
        accessToken: data['access_token'] as string,
        refreshToken: data['refresh_token'] as string | undefined,
        expiresIn: data['expires_in'] as number | undefined,
        scope: data['scope'] as string | undefined,
        email: data['email'] as string | undefined,
      },
    };
  },

  async refreshAccessToken({ refreshToken }): Promise<TokenSet> {
    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...MSH_HEADERS,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error(`Kimi token refresh failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      accessToken: data['access_token'] as string,
      refreshToken: (data['refresh_token'] as string | undefined) ?? refreshToken,
      expiresIn: data['expires_in'] as number | undefined,
      scope: data['scope'] as string | undefined,
    };
  },
};
