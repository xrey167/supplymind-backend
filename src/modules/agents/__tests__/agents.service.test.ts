import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { AgentsService } from '../agents.service';
import { Topics } from '../../../events/topics';

const mockFindByWorkspace = mock(() => Promise.resolve([]));
const mockFindById = mock(() => Promise.resolve(null));
const mockCreate = mock(() => Promise.resolve(null));
const mockUpdate = mock(() => Promise.resolve(null));
const mockRemove = mock(() => Promise.resolve(undefined));

const mockRepo = {
  findByWorkspace: mockFindByWorkspace,
  findById: mockFindById,
  create: mockCreate,
  update: mockUpdate,
  remove: mockRemove,
} as any;

const mockPublish = mock(() => Promise.resolve());
const mockBus = { publish: mockPublish } as any;

// Minimal DB row shape matching agentConfigs.$inferSelect
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    provider: 'anthropic',
    mode: 'chat',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a helpful assistant',
    temperature: 0.7,
    maxTokens: 2048,
    toolIds: [],
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

const input = {
  workspaceId: 'ws-1',
  name: 'Test Agent',
  provider: 'anthropic' as const,
  mode: 'raw' as const,
  model: 'claude-sonnet-4-20250514',
};

const updateInput = { name: 'Updated Name' };

describe('AgentsService', () => {
  let service: AgentsService;

  beforeEach(() => {
    service = new AgentsService(mockRepo, mockBus);
    mockFindByWorkspace.mockReset();
    mockFindById.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockRemove.mockReset();
    mockPublish.mockReset();
  });

  describe('list', () => {
    test('should pass workspaceId to repo', async () => {
      mockFindByWorkspace.mockResolvedValue([]);
      await service.list('ws-1');
      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1');
    });

    test('should return empty array when workspace has no agents', async () => {
      mockFindByWorkspace.mockResolvedValue([]);
      const result = await service.list('ws-1');
      expect(result).toEqual([]);
    });

    test('should return mapped agents for workspace', async () => {
      const rows = [makeRow(), makeRow({ id: 'agent-2', name: 'Agent 2' })];
      mockFindByWorkspace.mockResolvedValue(rows);
      const result = await service.list('ws-1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('agent-1');
      expect(result[1].id).toBe('agent-2');
    });
  });

  describe('getById', () => {
    test('should pass id to repo findById', async () => {
      mockFindById.mockResolvedValue(null);
      await service.getById('agent-1');
      expect(mockFindById).toHaveBeenCalledWith('agent-1');
    });

    test('should return ok result with agent when found', async () => {
      mockFindById.mockResolvedValue(makeRow());
      const result = await service.getById('agent-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.id).toBe('agent-1');
    });

    test('should return err result when agent not found', async () => {
      mockFindById.mockResolvedValue(null);
      const result = await service.getById('missing-id');
      expect(result.ok).toBe(false);
    });
  });

  describe('create', () => {
    test('should return ok result with created agent', async () => {
      const row = makeRow({ id: 'new-agent', name: 'New Agent' });
      mockCreate.mockResolvedValue(row);
      const result = await service.create(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.id).toBe('new-agent');
    });

    test('should call repo create with input', async () => {
      const row = makeRow();
      mockCreate.mockResolvedValue(row);
      await service.create(input);
      expect(mockCreate).toHaveBeenCalledWith(input);
    });

    test('should publish AGENT_CREATED event after creation', async () => {
      mockCreate.mockResolvedValue(makeRow());
      await service.create(input);
      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish.mock.calls[0][0]).toBe(Topics.AGENT_CREATED);
    });

    test('should publish event with correct agentId and workspaceId', async () => {
      mockCreate.mockResolvedValue(makeRow({ id: 'pub-agent', workspaceId: 'ws-2' }));
      await service.create({ ...input, workspaceId: 'ws-2' });
      const payload = mockPublish.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.agentId).toBe('pub-agent');
      expect(payload.workspaceId).toBe('ws-2');
    });
  });

  describe('update', () => {
    test('should pass id and input to repo update', async () => {
      mockUpdate.mockResolvedValue(makeRow());
      await service.update('agent-1', updateInput);
      expect(mockUpdate).toHaveBeenCalledWith('agent-1', updateInput);
    });

    test('should return ok result with updated agent when found', async () => {
      const row = makeRow({ name: 'Updated Name' });
      mockUpdate.mockResolvedValue(row);
      const result = await service.update('agent-1', updateInput);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe('Updated Name');
    });

    test('should return err result when agent not found', async () => {
      mockUpdate.mockResolvedValue(null);
      const result = await service.update('missing', updateInput);
      expect(result.ok).toBe(false);
    });

    test('should publish AGENT_UPDATED event when update succeeds', async () => {
      mockUpdate.mockResolvedValue(makeRow());
      await service.update('agent-1', updateInput);
      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish.mock.calls[0][0]).toBe(Topics.AGENT_UPDATED);
    });

    test('should not publish event when agent not found', async () => {
      mockUpdate.mockResolvedValue(null);
      await service.update('missing', updateInput);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    test('should include all changed field names in event', async () => {
      mockUpdate.mockResolvedValue(makeRow());
      await service.update('agent-1', { name: 'New', model: 'gpt-4' });
      const payload = mockPublish.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.changes).toEqual(['name', 'model']);
    });
  });

  describe('remove', () => {
    test('should call repo remove with id', async () => {
      await service.remove('agent-1');
      expect(mockRemove).toHaveBeenCalledWith('agent-1');
    });

    test('should resolve without error', async () => {
      await expect(service.remove('agent-1')).resolves.toBeUndefined();
    });
  });
});
