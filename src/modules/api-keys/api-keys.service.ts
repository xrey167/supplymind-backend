import { apiKeysRepo } from './api-keys.repo';
import { createApiKey } from '../../infra/auth/api-key';
import type { ApiKey, CreateApiKeyInput, CreateApiKeyResult } from './api-keys.types';
import type { Role } from '../../core/security';

export const apiKeysService = {
  async create(workspaceId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const { token, keyInfo } = await createApiKey({
      workspaceId,
      name: input.name,
      role: input.role as Role,
      expiresAt: input.expiresAt,
    });

    const key = await apiKeysRepo.get(keyInfo.id, workspaceId);

    return { token, key: key! };
  },

  async list(workspaceId: string): Promise<ApiKey[]> {
    return apiKeysRepo.list(workspaceId);
  },

  async get(id: string, workspaceId: string): Promise<ApiKey | null> {
    return apiKeysRepo.get(id, workspaceId);
  },

  async revoke(id: string, workspaceId: string): Promise<boolean> {
    return apiKeysRepo.revoke(id, workspaceId);
  },

  async deleteKey(id: string, workspaceId: string): Promise<boolean> {
    return apiKeysRepo.deleteKey(id, workspaceId);
  },
};

// Re-export class for backward compat with index.ts
export class ApiKeysService {}
