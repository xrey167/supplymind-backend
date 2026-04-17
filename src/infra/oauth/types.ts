export type OAuthFlowType = 'authorization_code_pkce' | 'device_code' | 'token_import';
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
  /** provider-specific extra data needed for polling (e.g. Kiro clientId/clientSecret) */
  extraData?: Record<string, unknown>;
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
  /** Whether this provider supports token refresh. Defaults to true. */
  supportsRefresh?: boolean;

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

  /** Only for device_code — extraData carries provider-specific poll credentials */
  pollToken?(deviceCode: string, extraData?: Record<string, unknown>): Promise<PollResult>;

  /** Both flow types — refresh access token using refresh token */
  refreshAccessToken?(params: {
    refreshToken: string;
    providerData?: Record<string, unknown>;
  }): Promise<TokenSet>;

  /** Only for token_import — validate and normalize a user-supplied access token */
  normalizeImportedToken?(accessToken: string): Promise<TokenSet>;
}
