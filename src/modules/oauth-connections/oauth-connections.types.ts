export type OAuthProvider = 'claude' | 'google' | 'openai' | 'github';
export type OAuthConnectionStatus = 'active' | 'error' | 'expired';

export interface OAuthConnection {
  id: string;
  workspaceId: string;
  provider: OAuthProvider;
  email: string | null;
  displayName: string | null;
  scope: string | null;
  status: OAuthConnectionStatus;
  lastError: string | null;
  lastRefreshedAt: Date | null;
  expiresAt: Date | null;
  providerData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreTokenInput {
  workspaceId: string;
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  email?: string;
  displayName?: string;
  scope?: string;
  providerData?: Record<string, unknown>;
}
