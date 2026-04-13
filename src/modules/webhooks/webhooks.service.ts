import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError } from '../../core/errors';
import { webhooksRepo } from './webhooks.repo';
import type { WebhookEndpoint, WebhookDelivery, CreateEndpointInput, IngestInput, IngestResult } from './webhooks.types';

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function verifyHmac(secret: string, rawBody: string, signature: string): boolean {
  try {
    const hasher = new Bun.CryptoHasher('sha256', secret);
    hasher.update(rawBody);
    const expected = 'sha256=' + hasher.digest('hex');
    return expected === signature;
  } catch {
    return false;
  }
}

function sha256hex(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex');
}

class WebhooksService {
  async createEndpoint(input: CreateEndpointInput): Promise<WebhookEndpoint & { secret: string }> {
    const token = generateToken();
    const secret = generateSecret();
    const endpoint = await webhooksRepo.createEndpoint({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      token,
      secretHash: secret, // stored as-is; needed for HMAC verification
      createdBy: input.createdBy,
    });
    return { ...endpoint, secret };
  }

  async listEndpoints(workspaceId: string): Promise<WebhookEndpoint[]> {
    return webhooksRepo.listEndpoints(workspaceId);
  }

  async deleteEndpoint(id: string, workspaceId: string): Promise<void> {
    await webhooksRepo.deleteEndpoint(id, workspaceId);
  }

  async listDeliveries(endpointId: string, workspaceId: string): Promise<WebhookDelivery[]> {
    const endpoints = await webhooksRepo.listEndpoints(workspaceId);
    const owned = endpoints.find(e => e.id === endpointId);
    if (!owned) throw new NotFoundError(`Webhook endpoint ${endpointId} not found`);
    return webhooksRepo.listDeliveries(endpointId, workspaceId);
  }

  async verifyAndIngest(input: IngestInput): Promise<IngestResult> {
    const endpoint = await webhooksRepo.findByToken(input.token);
    if (!endpoint || !endpoint.active) return { accepted: false, duplicate: false };

    if (!verifyHmac(endpoint.secretHash, input.rawBody, input.signature)) {
      return { accepted: false, duplicate: false };
    }

    // Fallback delivery key: sha256 of raw body if no X-Delivery-ID provided
    const deliveryKey = input.deliveryKey || sha256hex(input.rawBody);

    const inserted = await webhooksRepo.insertDelivery({
      endpointId: endpoint.id,
      workspaceId: endpoint.workspaceId,
      deliveryKey,
      payload: input.payload,
      headers: input.headers,
    });

    if (!inserted) return { accepted: true, duplicate: true };

    eventBus.publish(Topics.WEBHOOK_RECEIVED, {
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      deliveryId: inserted.id,
      payload: input.payload,
    }).catch(() => {});

    await webhooksRepo.markDeliveryProcessed(inserted.id);
    return { accepted: true, duplicate: false };
  }
}

export const webhooksService = new WebhooksService();
