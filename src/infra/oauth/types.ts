export type OAuthFlowType = 'authorization_code_pkce' | 'device_code';
export type OAuthConnectionStatus = 'active' | 'error' | 'expired';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** seconds until access token expires */
  expiresIn?: number;
  scope?: string;
  email?: string;
  displayName?: string;
  /** provider-specific extra data (e.g. workspaceId for OpenAI) */
  providerData?: Record<string, unknown>;
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** seconds */
  interval: number;
  /** seconds */
  expiresIn: number;
}

export interface PollResult {
  success: boolean;
  tokens?: TokenSet;
  /** still waiting for user to authorize */
  pending?: boolean;
  error?: string;
  errorDescription?: string;
}

export interface OAuthProvider {
  /** Unique slug, e.g. 'claude', 'google', 'openai', 'github' */
  id: string;
  displayName: string;
  flowType: OAuthFlowType;

  /** Only for authorization_code_pkce */
  buildAuthUrl?(params: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;

  /** Only for authorization_code_pkce */
  exchangeCode?(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    state?: string;
  }): Promise<TokenSet>;

  /** Only for device_code */
  requestDeviceCode?(): Promise<DeviceCodeResponse>;

  /** Only for device_code */
  pollToken?(deviceCode: string): Promise<PollResult>;

  /** Both flow types — refresh access token using refresh token */
  refreshAccessToken?(params: {
    refreshToken: string;
    providerData?: Record<string, unknown>;
  }): Promise<TokenSet>;
}
