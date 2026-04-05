import type { ApiKey } from './api-keys.types';

export function toApiKeyResponse(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    role: key.role,
    enabled: key.enabled,
    keyPrefix: key.keyPrefix,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt?.toISOString() ?? null,
  };
}
