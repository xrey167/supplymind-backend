import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockProfile = {
  id: 'ap-1',
  workspaceId: 'ws-1',
  name: 'Executor',
  category: 'executor' as const,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  systemPrompt: null,
  temperature: 0.7,
  maxTokens: 4096,
  permissionMode: 'ask' as const,
  isDefault: true,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRepo = {
  create: mock(async () => mockProfile),
  findById: mock(async (id: string) => (id === 'ap-1' ? mockProfile : null)),
  findByWorkspace: mock(async () => [mockProfile]),
  findDefault: mock(async () => mockProfile),
  update: mock(async (id: string) => (id === 'ap-1' ? { ...mockProfile, name: 'Updated' } : null)),
  remove: mock(async () => undefined),
};

const mockBus = { publish: mock(async () => undefined) };

mock.module('../../events/bus', () => ({ eventBus: mockBus }));
// MissionTopics imported directly from the plugin (static as const) — no mock needed
mock.module('../agent-profiles.repo', () => ({ agentProfilesRepo: mockRepo }));
mock.module('../../core/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(msg = 'Not found') { super(msg); }
  },
  AppError: class AppError extends Error {
    constructor(public message: string, public statusCode = 500, public code?: string) { super(message); }
  },
}));

const { AgentProfilesService } = await import('../agent-profiles.service');

describe('AgentProfilesService', () => {
  let service: InstanceType<typeof AgentProfilesService>;

  beforeEach(() => {
    service = new AgentProfilesService(mockRepo as any, mockBus as any);
    mockBus.publish.mockClear();
  });

  it('create() returns profile and publishes event', async () => {
    const r = await service.create('ws-1', { name: 'Executor', category: 'executor' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toBe('ap-1');
    expect(mockBus.publish).toHaveBeenCalledWith('agent_profile.created', expect.objectContaining({ workspaceId: 'ws-1' }));
  });

  it('get() returns profile by id', async () => {
    const r = await service.get('ap-1');
    expect(r.ok).toBe(true);
  });

  it('get() returns err for unknown id', async () => {
    const r = await service.get('unknown');
    expect(r.ok).toBe(false);
  });

  it('list() returns array', async () => {
    const profiles = await service.list('ws-1');
    expect(Array.isArray(profiles)).toBe(true);
  });

  it('update() returns updated profile', async () => {
    const r = await service.update('ap-1', { name: 'Updated' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('Updated');
  });

  it('update() returns err for unknown id', async () => {
    const r = await service.update('unknown', { name: 'x' });
    expect(r.ok).toBe(false);
  });

  it('remove() succeeds and publishes event', async () => {
    const r = await service.remove('ap-1');
    expect(r.ok).toBe(true);
    expect(mockBus.publish).toHaveBeenCalledWith('agent_profile.deleted', expect.anything());
  });

  it('remove() returns err for unknown id', async () => {
    const r = await service.remove('unknown');
    expect(r.ok).toBe(false);
  });

  it('resolveForCategory() returns default profile for category', async () => {
    const profile = await service.resolveForCategory('ws-1', 'executor');
    expect(profile?.id).toBe('ap-1');
  });
});

afterAll(() => mock.restore());
