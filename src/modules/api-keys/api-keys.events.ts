import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';

export function emitApiKeyCreated(keyId: string, workspaceId: string, name: string): void {
  eventBus.publish(Topics.API_KEY_CREATED, { keyId, workspaceId, name }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish API_KEY_CREATED');
  });
}

export function emitApiKeyRevoked(keyId: string, workspaceId: string): void {
  eventBus.publish(Topics.API_KEY_REVOKED, { keyId, workspaceId }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish API_KEY_REVOKED');
  });
}

export function emitApiKeyDeleted(keyId: string, workspaceId: string): void {
  eventBus.publish(Topics.API_KEY_DELETED, { keyId, workspaceId }).catch((err) => {
    logger.error({ err, keyId, workspaceId }, 'Failed to publish API_KEY_DELETED');
  });
}
