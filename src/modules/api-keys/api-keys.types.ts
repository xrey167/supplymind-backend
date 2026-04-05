import type { Role } from '../../core/security';

export interface ApiKey {
  id: string;
  workspaceId: string;
  name: string;
  role: Role;
  enabled: boolean;
  keyPrefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date | null;
}

export interface CreateApiKeyInput {
  name: string;
  role?: Role;
  expiresAt?: Date;
}

export interface CreateApiKeyResult {
  token: string;
  key: ApiKey;
}
