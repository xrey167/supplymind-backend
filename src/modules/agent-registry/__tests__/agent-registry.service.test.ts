import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';
import type { AgentCard } from '../../../engine/a2a/types';
import type { RegisteredAgent } from '../agent-registry.types';

const defaultCard: AgentCard = {
  name: 'Test Agent',
  description: 'A test agent',
  url: 'http://localhost:9000',
  version: '1.0.0',
  capabilities: { streaming: false },
  skills: [{ id: 'skill-1', name: 'Skill 1', description: 'Test skill' }],
};

const stubCard: AgentCard = {
  name: 'Test Agent',
  description: '',
  url: 'http://localhost:9000',
  version: '0.0.0',
  capabilities: { streaming: false },
  skills: [],
};

// Use dependency injection (no mock.module needed for workerRegistry — avoids
// contaminating worker-registry.test.ts).
const mockDiscover = mock(async (_url: string, _apiKey?: string): Promise<AgentCard> => defaultCard);
const mockLoad = mock((_url: string, _card: AgentCard, _apiKey?: string, _registeredAt?: number) => {});
const mockRemove = mock((_url: string) => {});
const mockWorkerRegistry = { discover: mockDiscover, load: mockLoad, remove: mockRemove } as any;

// Mock the repo
const mockCreate = mock(async (data: Parameters<typeof import('../agent-registry.repo').agentRegistryRepo.registerAgent>[0]): Promise<RegisteredAgent> => ({
  id: 'agent-uuid-1',
  workspaceId: data.workspaceId,
  url: data.url,
  agentCard: data.agentCard as unknown as AgentCard,
  enabled: true,
  lastDiscoveredAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const mockFindByWorkspace = mock(async (workspaceId: string): Promise<RegisteredAgent[]> => [
  {
    id: 'agent-uuid-1',
    workspaceId,
    url: 'http://localhost:9000',
    agentCard: stubCard,
    enabled: true,
    lastDiscoveredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]);

const mockFindByWorkspaceAndUrl = mock(async (_workspaceId: string, _url: string): Promise<RegisteredAgent | undefined> => undefined);

const mockFindById = mock(async (id: string): Promise<RegisteredAgent | undefined> => ({
  id,
  workspaceId: 'ws-1',
  url: 'http://localhost:9000',
  agentCard: stubCard,
  enabled: true,
  lastDiscoveredAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const mockRepoRemove = mock(async (_id: string): Promise<void> => {});
const mockUpdateDiscoveredAt = mock(async (id: string): Promise<RegisteredAgent | undefined> => ({
  id,
  workspaceId: 'ws-1',
  url: 'http://localhost:9000',
  agentCard: stubCard,
  enabled: true,
  lastDiscoveredAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}));

// Use direct DI for the repo mock too (no mock.module needed)
const mockAgentRegistryRepo = {
  registerAgent: mockCreate,
  findByWorkspace: mockFindByWorkspace,
  findByWorkspaceAndUrl: mockFindByWorkspaceAndUrl,
  findAgentById: mockFindById,
  remove: mockRepoRemove,
  updateDiscoveredAt: mockUpdateDiscoveredAt,
  listRegistered: mock(async () => []),
  disable: mock(async () => {}),
} as any;

import { AgentRegistryService } from '../agent-registry.service';

describe('AgentRegistryService', () => {
  let service: InstanceType<typeof AgentRegistryService>;

  beforeEach(() => {
    service = new AgentRegistryService(mockWorkerRegistry, mockAgentRegistryRepo);
    mockDiscover.mockClear();
    mockLoad.mockClear();
    mockRemove.mockClear();
    mockCreate.mockClear();
    mockFindByWorkspace.mockClear();
    mockFindByWorkspaceAndUrl.mockClear();
    mockFindById.mockClear();
    mockRepoRemove.mockClear();
  });

  describe('register()', () => {
    it('calls workerRegistry.discover() and saves to DB', async () => {
      const result = await service.register('ws-1', 'http://localhost:9000');

      expect(result.ok).toBe(true);
      expect(mockDiscover).toHaveBeenCalledWith('http://localhost:9000', undefined);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockLoad).toHaveBeenCalledTimes(1);
    });

    it('passes apiKey to discover', async () => {
      const result = await service.register('ws-1', 'http://localhost:9000', 'secret-key');

      expect(result.ok).toBe(true);
      expect(mockDiscover).toHaveBeenCalledWith('http://localhost:9000', 'secret-key');
    });

    it('updates existing registration if url already registered for workspace', async () => {
      mockFindByWorkspaceAndUrl.mockImplementationOnce(async () => ({
        id: 'existing-id',
        workspaceId: 'ws-1',
        url: 'http://localhost:9000',
        agentCard: stubCard,
        enabled: true,
        lastDiscoveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.register('ws-1', 'http://localhost:9000');

      expect(result.ok).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdateDiscoveredAt).toHaveBeenCalledWith('existing-id', expect.any(Object), undefined);
    });

    it('hashes apiKey and stores it on create', async () => {
      await service.register('ws-1', 'http://localhost:9000', 'secret-key');
      const callArg = mockCreate.mock.calls[0][0];
      expect(callArg.apiKeyHash).toBeDefined();
      expect(callArg.apiKeyHash).not.toBe('secret-key');
    });

    it('registers with stub card when discover fails', async () => {
      mockDiscover.mockImplementationOnce(async () => { throw new Error('Connection refused'); });

      const result = await service.register('ws-1', 'http://bad-url:9999');

      // Discovery failure is non-fatal — registration succeeds with a minimal stub card
      expect(result.ok).toBe(true);
    });
  });

  describe('list()', () => {
    it('returns agents for the given workspace', async () => {
      const result = await service.list('ws-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].workspaceId).toBe('ws-1');
      }
      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('remove()', () => {
    it('calls repo.remove() and removes from in-memory registry', async () => {
      const result = await service.remove('ws-1', 'agent-uuid-1');

      expect(result.ok).toBe(true);
      expect(mockRepoRemove).toHaveBeenCalledWith('agent-uuid-1');
      expect(mockRemove).toHaveBeenCalledWith('http://localhost:9000');
    });

    it('returns err when agent not found', async () => {
      mockFindById.mockImplementationOnce(async () => undefined);

      const result = await service.remove('ws-1', 'nonexistent-id');

      expect(result.ok).toBe(false);
      expect(mockRepoRemove).not.toHaveBeenCalled();
    });

    it('returns err when agent belongs to different workspace', async () => {
      mockFindById.mockImplementationOnce(async (id) => ({
        id,
        workspaceId: 'ws-other',
        url: 'http://localhost:9000',
        agentCard: stubCard,
        enabled: true,
        lastDiscoveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.remove('ws-1', 'agent-uuid-1');

      expect(result.ok).toBe(false);
      expect(mockRepoRemove).not.toHaveBeenCalled();
    });
  });
});

afterAll(() => mock.restore());
