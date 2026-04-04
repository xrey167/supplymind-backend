import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the repo module before importing the service
const mockFindByWorkspace = mock(() => Promise.resolve([]));
const mockFindById = mock(() => Promise.resolve(null));
const mockCreate = mock(() => Promise.resolve(null));
const mockUpdate = mock(() => Promise.resolve(null));
const mockRemove = mock(() => Promise.resolve(undefined));

mock.module('../agents.repo', () => ({
  agentsRepo: {
    findByWorkspace: mockFindByWorkspace,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
  },
}));

// Mock the event bus
const mockPublish = mock(() => Promise.resolve());

mock.module('../../../events/bus', () => ({
  eventBus: {
    publish: mockPublish,
  },
}));

// Import after mocking
import { AgentsService } from '../agents.service';
import { Topics } from '../../../events/topics';

// Minimal DB row shape matching agentConfigs.$inferSelect
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    provider: 'anthropic',
    mode: 'chat',
    model: 'claude-3-5-haiku-latest',
    systemPrompt: null,
    temperature: null,
    maxTokens: null,
    toolIds: null,
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('AgentsService', () => {
  let service: AgentsService;

  beforeEach(() => {
    service = new AgentsService();
    mockFindByWorkspace.mockClear();
    mockFindById.mockClear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockRemove.mockClear();
    mockPublish.mockClear();
  });

  describe('list', () => {
    test('should return empty array when workspace has no agents', async () => {
      mockFindByWorkspace.mockResolvedValue([]);

      const result = await service.list('ws-1');

      expect(result).toEqual([]);
      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1');
    });

    test('should return mapped agents for workspace', async () => {
      const row = makeRow();
      mockFindByWorkspace.mockResolvedValue([row]);

      const result = await service.list('ws-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-1');
      expect(result[0].workspaceId).toBe('ws-1');
      expect(result[0].name).toBe('Test Agent');
    });

    test('should pass workspaceId to repo', async () => {
      mockFindByWorkspace.mockResolvedValue([]);

      await service.list('ws-specific');

      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-specific');
    });
  });

  describe('getById', () => {
    test('should return ok result with agent when found', async () => {
      const row = makeRow({ id: 'agent-42' });
      mockFindById.mockResolvedValue(row);

      const result = await service.getById('agent-42');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('agent-42');
      }
    });

    test('should return err result when agent not found', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.getById('missing-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Agent not found: missing-id');
      }
    });

    test('should pass id to repo findById', async () => {
      mockFindById.mockResolvedValue(null);

      await service.getById('agent-99');

      expect(mockFindById).toHaveBeenCalledWith('agent-99');
    });
  });

  describe('create', () => {
    const input = {
      workspaceId: 'ws-1',
      name: 'New Agent',
      provider: 'anthropic' as const,
      mode: 'chat' as const,
      model: 'claude-3-5-haiku-latest',
    };

    test('should return ok result with created agent', async () => {
      const row = makeRow({ id: 'new-agent', name: 'New Agent' });
      mockCreate.mockResolvedValue(row);

      const result = await service.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('new-agent');
        expect(result.value.name).toBe('New Agent');
      }
    });

    test('should call repo create with input', async () => {
      const row = makeRow();
      mockCreate.mockResolvedValue(row);

      await service.create(input);

      expect(mockCreate).toHaveBeenCalledWith(input);
    });

    test('should publish AGENT_CREATED event after creation', async () => {
      const row = makeRow({ id: 'agent-1', workspaceId: 'ws-1', name: 'Test Agent' });
      mockCreate.mockResolvedValue(row);

      await service.create(input);

      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith(Topics.AGENT_CREATED, {
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        name: 'Test Agent',
      });
    });

    test('should publish event with correct agentId and workspaceId', async () => {
      const row = makeRow({ id: 'agent-xyz', workspaceId: 'ws-abc' });
      mockCreate.mockResolvedValue(row);

      await service.create(input);

      const [topic, data] = mockPublish.mock.calls[0];
      expect(topic).toBe(Topics.AGENT_CREATED);
      expect((data as Record<string, unknown>).agentId).toBe('agent-xyz');
      expect((data as Record<string, unknown>).workspaceId).toBe('ws-abc');
    });
  });

  describe('update', () => {
    const updateInput = { name: 'Updated Name' };

    test('should return ok result with updated agent when found', async () => {
      const row = makeRow({ name: 'Updated Name' });
      mockUpdate.mockResolvedValue(row);

      const result = await service.update('agent-1', updateInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Updated Name');
      }
    });

    test('should return err result when agent not found', async () => {
      mockUpdate.mockResolvedValue(null);

      const result = await service.update('missing-id', updateInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Agent not found: missing-id');
      }
    });

    test('should publish AGENT_UPDATED event when update succeeds', async () => {
      const row = makeRow({ id: 'agent-1' });
      mockUpdate.mockResolvedValue(row);

      await service.update('agent-1', updateInput);

      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith(Topics.AGENT_UPDATED, {
        agentId: 'agent-1',
        changes: ['name'],
      });
    });

    test('should include all changed field names in event', async () => {
      const row = makeRow();
      mockUpdate.mockResolvedValue(row);
      const multiInput = { name: 'New', model: 'claude-3-opus' };

      await service.update('agent-1', multiInput);

      const [, data] = mockPublish.mock.calls[0];
      expect((data as Record<string, unknown>).changes).toEqual(
        expect.arrayContaining(['name', 'model']),
      );
    });

    test('should not publish event when agent not found', async () => {
      mockUpdate.mockResolvedValue(null);

      await service.update('missing-id', updateInput);

      expect(mockPublish).not.toHaveBeenCalled();
    });

    test('should pass id and input to repo update', async () => {
      const row = makeRow();
      mockUpdate.mockResolvedValue(row);

      await service.update('agent-1', updateInput);

      expect(mockUpdate).toHaveBeenCalledWith('agent-1', updateInput);
    });
  });

  describe('remove', () => {
    test('should call repo remove with id', async () => {
      mockRemove.mockResolvedValue(undefined);

      await service.remove('agent-1');

      expect(mockRemove).toHaveBeenCalledWith('agent-1');
    });

    test('should resolve without error', async () => {
      mockRemove.mockResolvedValue(undefined);

      await expect(service.remove('agent-1')).resolves.toBeUndefined();
    });
  });
});
