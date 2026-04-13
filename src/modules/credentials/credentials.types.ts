export type CredentialProvider = 'anthropic' | 'openai' | 'google' | 'custom' | 'slack' | 'telegram';

export interface Credential {
  id: string;
  workspaceId: string;
  name: string;
  provider: CredentialProvider;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCredentialInput {
  workspaceId: string;
  name: string;
  provider: CredentialProvider;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCredentialInput {
  name?: string;
  value?: string;
  metadata?: Record<string, unknown>;
}

/** Internal row shape including encrypted fields */
export interface CredentialRow {
  id: string;
  workspaceId: string;
  name: string;
  provider: CredentialProvider;
  encryptedValue: string;
  iv: string;
  tag: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
