import { describe, test, expect, beforeEach, mock, afterAll, beforeAll } from 'bun:test';
import type { Credential } from '../credentials.types';

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-master-key-for-unit-tests-32b';
});

// Mock state
const mockRows = new Map<string, any>();
let lastInsert: any = null;
const publishedEvents: { topic: string; data: any }[] = [];

// Mock modules using paths relative to the SERVICE file (not the test file)
// Re-export the real eventBus alongside mock overrides to avoid contaminating
// other test files that depend on the real eventBus (e.g. task-manager.test.ts).
const _realBus = require('../../../events/bus');
const _origCredPublish = _realBus.eventBus.publish.bind(_realBus.eventBus);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'publish') return (...args: any[]) => { const [topic, data] = args; publishedEvents.push({ topic, data }); return _origCredPublish(...args); };
      return target[prop];
    },
  }),
}));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
}));

mock.module('../credentials.repo', () => ({
  CredentialsRepository: class {},
  credentialsRepo: {
    createCredential: async (input: any) => {
      const row: Credential = {
        id: 'cred-' + String(mockRows.size + 1).padStart(3, '0'),
        workspaceId: input.workspaceId,
        name: input.name,
        provider: input.provider,
        metadata: input.metadata ?? {},
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      lastInsert = { ...input, id: row.id };
      mockRows.set(row.id, {
        ...row,
        encryptedValue: input.encryptedValue,
        iv: input.iv,
        tag: input.tag,
      });
      return row;
    },
    findById: async (id: string) => mockRows.get(id) ?? null,
    list: async (workspaceId: string) => {
      return Array.from(mockRows.values())
        .filter((r) => r.workspaceId === workspaceId)
        .map(({ encryptedValue, iv, tag, ...rest }: any) => rest);
    },
    updateCredential: async (id: string, data: any) => {
      const existing = mockRows.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockRows.set(id, updated);
      const { encryptedValue, iv, tag, ...credential } = updated;
      return credential;
    },
    remove: async (id: string) => {
      const existed = mockRows.has(id);
      mockRows.delete(id);
      return existed;
    },
  },
}));

// Import service AFTER mocks are set up
const { CredentialsService } = await import('../credentials.service');
const service = new CredentialsService();

describe('CredentialsService', () => {
  beforeEach(() => {
    mockRows.clear();
    publishedEvents.length = 0;
    lastInsert = null;
  });

  test('create encrypts value and returns credential without secrets', async () => {
    const result = await service.create({
      workspaceId: 'ws-001',
      name: 'Anthropic Key',
      provider: 'anthropic',
      value: 'sk-ant-secret',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe('Anthropic Key');
    expect(result.value.provider).toBe('anthropic');
    expect((result.value as any).encryptedValue).toBeUndefined();

    // Repo received encrypted data
    expect(lastInsert.encryptedValue).toBeTruthy();
    expect(lastInsert.iv).toBeTruthy();
    expect(lastInsert.tag).toBeTruthy();

    // Event emitted
    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].topic).toBe('credentials.created');
  });

  test('list returns credentials without secrets', async () => {
    await service.create({ workspaceId: 'ws-001', name: 'Key 1', provider: 'openai', value: 'secret1' });
    await service.create({ workspaceId: 'ws-001', name: 'Key 2', provider: 'google', value: 'secret2' });

    const list = await service.list('ws-001');
    expect(list.length).toBe(2);
    for (const cred of list) {
      expect((cred as any).encryptedValue).toBeUndefined();
    }
  });

  test('getDecrypted returns raw value for correct workspace', async () => {
    await service.create({ workspaceId: 'ws-001', name: 'Key', provider: 'anthropic', value: 'my-secret-key' });

    const id = Array.from(mockRows.keys())[0]!;
    const result = await service.getDecrypted(id, 'ws-001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('my-secret-key');
    }
  });

  test('getDecrypted rejects workspace mismatch', async () => {
    await service.create({ workspaceId: 'ws-001', name: 'Key', provider: 'anthropic', value: 'secret' });

    const id = Array.from(mockRows.keys())[0]!;
    const result = await service.getDecrypted(id, 'ws-other');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('mismatch');
    }
  });

  test('delete emits event and returns true', async () => {
    await service.create({ workspaceId: 'ws-001', name: 'Key', provider: 'custom', value: 'x' });
    const id = Array.from(mockRows.keys())[0]!;
    publishedEvents.length = 0;

    const deleted = await service.delete(id);
    expect(deleted).toBe(true);
    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].topic).toBe('credentials.deleted');
  });

  test('delete returns false for non-existent id', async () => {
    const deleted = await service.delete('non-existent');
    expect(deleted).toBe(false);
  });
});

afterAll(() => mock.restore());
