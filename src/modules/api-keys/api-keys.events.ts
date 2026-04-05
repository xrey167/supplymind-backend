import { eventBus } from '../../events/bus';

export function emitApiKeyCreated(keyId: string, workspaceId: string, name: string): void {
  eventBus.publish('security.api_key.created', { keyId, workspaceId, name });
}

export function emitApiKeyRevoked(keyId: string, workspaceId: string): void {
  eventBus.publish('security.api_key.revoked', { keyId, workspaceId });
}

export function emitApiKeyDeleted(keyId: string, workspaceId: string): void {
  eventBus.publish('security.api_key.deleted', { keyId, workspaceId });
}
