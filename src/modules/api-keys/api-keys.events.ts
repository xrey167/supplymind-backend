import { eventBus } from '../../events/bus';
import { logger } from '../../config/logger';

export function emitApiKeyCreated(keyId: string, workspaceId: string, name: string): void {
  eventBus.publish('security.api_key.created', { keyId, workspaceId, name }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish security.api_key.created');
  });
}

export function emitApiKeyRevoked(keyId: string, workspaceId: string): void {
  eventBus.publish('security.api_key.revoked', { keyId, workspaceId }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish security.api_key.revoked — downstream revocation may be delayed');
  });
}

export function emitApiKeyDeleted(keyId: string, workspaceId: string): void {
  eventBus.publish('security.api_key.deleted', { keyId, workspaceId }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish security.api_key.deleted');
  });
}
