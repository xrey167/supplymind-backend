import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

// ── Mock handles ──────────────────────────────────────────────────────────────

const mockBusPublish = mock(async () => {});

const mockRepo = {
  createEndpoint: mock(async (v: any) => ({
    id: 'ep-1',
    workspaceId: v.workspaceId,
    name: v.name,
    description: null,
    token: v.token,
    active: true,
    createdBy: v.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  findByToken: mock(async (token: string) => token === 'valid-token' ? ({
    id: 'ep-1', workspaceId: 'ws-1', name: 'Test', description: null,
    token: 'valid-token', active: true, createdBy: 'user-1',
    createdAt: new Date(), updatedAt: new Date(),
    secretHash: 'my-secret',
  }) : null),
  listEndpoints: mock(async () => []),
  deleteEndpoint: mock(async () => {}),
  insertDelivery: mock(async () => ({
    id: 'del-1', endpointId: 'ep-1', workspaceId: 'ws-1',
    deliveryKey: 'key-1', payload: {}, headers: {},
    status: 'received' as const, processedAt: null, createdAt: new Date(),
  })),
  markDeliveryProcessed: mock(async () => {}),
  listDeliveries: mock(async () => []),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

mock.module('../webhooks.repo', () => ({ webhooksRepo: mockRepo }));

const _realBus = require('../../../events/bus');
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: any) {
      if (prop === 'publish') return mockBusPublish;
      return target[prop];
    },
  }),
}));

const { webhooksService } = await import('../webhooks.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function hmacSha256(secret: string, body: string): string {
  const hasher = new Bun.CryptoHasher('sha256', secret);
  hasher.update(body);
  return 'sha256=' + hasher.digest('hex');
}

function clearMocks() {
  mockBusPublish.mockClear();
  (Object.values(mockRepo) as ReturnType<typeof mock>[]).forEach(m => m.mockClear());
}

beforeEach(clearMocks);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhooksService.verifyAndIngest', () => {
  it('valid HMAC → accepted=true, duplicate=false, event published', async () => {
    const rawBody = JSON.stringify({ event: 'test' });
    const signature = hmacSha256('my-secret', rawBody);

    const result = await webhooksService.verifyAndIngest({
      token: 'valid-token',
      rawBody,
      signature,
      deliveryKey: 'delivery-abc',
      payload: { event: 'test' },
      headers: {},
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(mockRepo.insertDelivery).toHaveBeenCalledTimes(1);
    expect(mockRepo.markDeliveryProcessed).toHaveBeenCalledWith('del-1');
    await new Promise(r => setTimeout(r, 10));
    expect(mockBusPublish).toHaveBeenCalledWith(
      'webhook.received',
      expect.objectContaining({ workspaceId: 'ws-1', endpointId: 'ep-1' }),
    );
  });

  it('invalid HMAC → accepted=false, nothing written', async () => {
    const result = await webhooksService.verifyAndIngest({
      token: 'valid-token',
      rawBody: '{"event":"test"}',
      signature: 'sha256=wrongsignature',
      deliveryKey: 'delivery-abc',
      payload: { event: 'test' },
      headers: {},
    });

    expect(result.accepted).toBe(false);
    expect(mockRepo.insertDelivery).not.toHaveBeenCalled();
    expect(mockBusPublish).not.toHaveBeenCalled();
  });

  it('unknown token → accepted=false', async () => {
    const result = await webhooksService.verifyAndIngest({
      token: 'unknown-token',
      rawBody: '{}',
      signature: 'sha256=anything',
      deliveryKey: 'key',
      payload: {},
      headers: {},
    });

    expect(result.accepted).toBe(false);
    expect(mockRepo.insertDelivery).not.toHaveBeenCalled();
  });

  it('duplicate deliveryKey → accepted=true, duplicate=true, no event published', async () => {
    mockRepo.insertDelivery.mockImplementation(async () => null); // ON CONFLICT → null

    const rawBody = JSON.stringify({ event: 'dup' });
    const signature = hmacSha256('my-secret', rawBody);

    const result = await webhooksService.verifyAndIngest({
      token: 'valid-token',
      rawBody,
      signature,
      deliveryKey: 'already-seen',
      payload: { event: 'dup' },
      headers: {},
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(mockBusPublish).not.toHaveBeenCalled();
    expect(mockRepo.markDeliveryProcessed).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
