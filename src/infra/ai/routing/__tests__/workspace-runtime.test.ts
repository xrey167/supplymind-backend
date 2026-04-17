import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockCreateRuntime = mock((provider: string, mode: string) => ({
  provider,
  mode,
  run: async () => ({ ok: true as const, value: { content: '' } }),
  async *stream() { }
}));

const mockWithFallbackRuntime = mock((runtimes: unknown[]) => (runtimes[0] as any));
const mockWithHealthTracking = mock((runtime: unknown) => runtime);
const mockGetConfig = mock(async () => null as any);
const mockIncrementRoundRobinCounter = mock(async () => {});
const mockUpdateStrictRandomDeck = mock(async () => {});
const mockListForWorkspace = mock(async () => [] as any[]);

mock.module('../../runtime-factory', () => ({
  createRuntime: mockCreateRuntime,
  withFallbackRuntime: mockWithFallbackRuntime,
  withHealthTracking: mockWithHealthTracking,
}));

mock.module('../../circuit-breaker', () => ({
  getOpenProviders: async () => new Set<string>(),
}));

mock.module('../../health-store', () => ({
  getAllHealth: async () => new Map(),
}));

mock.module('../usage-counter', () => ({
  getUsageCounts: async () => new Map(),
  incrementUsage: async () => {},
  setLastKnownGood: async () => {},
  getLastKnownGood: async () => null,
}));

mock.module('../../../../modules/routing-config/routing-config.service', () => ({
  routingConfigService: { getConfig: mockGetConfig },
}));

mock.module('../../../../modules/routing-config/routing-config.repo', () => ({
  routingConfigRepo: {
    incrementRoundRobinCounter: mockIncrementRoundRobinCounter,
    updateStrictRandomDeck: mockUpdateStrictRandomDeck,
  },
}));

mock.module('../../../../modules/oauth-connections/oauth-connections.repo', () => ({
  oauthConnectionsRepo: { listForWorkspace: mockListForWorkspace },
}));

await import('../strategies');
const { buildWorkspaceRuntime } = await import('../workspace-runtime');

const baseConfig = {
  id: 'rc-1',
  workspaceId: 'ws-1',
  strategy: 'priority' as const,
  roundRobinCounter: 0,
  updatedAt: new Date(),
  providers: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 50, costPer1kTokens: 0.003, mode: 'raw' },
    { provider: 'openai', model: 'gpt-4o', weight: 50, costPer1kTokens: 0.002, mode: 'raw' },
  ],
};

describe('buildWorkspaceRuntime', () => {
  beforeEach(() => {
    mockCreateRuntime.mockClear();
    mockWithFallbackRuntime.mockClear();
    mockWithHealthTracking.mockClear();
    mockGetConfig.mockReset();
    mockIncrementRoundRobinCounter.mockClear();
    mockListForWorkspace.mockReset();
    mockListForWorkspace.mockResolvedValue([]);
  });

  test('falls back to anthropic when no routing config exists', async () => {
    mockGetConfig.mockResolvedValueOnce(null);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    expect(mockCreateRuntime.mock.calls[0][0]).toBe('anthropic');
  });

  test('selects primary provider from routing config', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).toContain('anthropic');
  });

  test('does not include explicitly excluded providers in fallback runtimes', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1', excludedProviders: ['openai'] });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).not.toContain('openai');
  });

  // T2.4 — credential-blocked provider filtering
  test('excludes providers with error oauth connection', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    mockListForWorkspace.mockResolvedValueOnce([
      { provider: 'openai', status: 'error' },
    ]);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).not.toContain('openai');
    expect(providers).toContain('anthropic');
  });

  test('excludes providers with expired oauth connection', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    mockListForWorkspace.mockResolvedValueOnce([
      { provider: 'openai', status: 'expired' },
    ]);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).not.toContain('openai');
  });

  test('does not exclude providers with active oauth connection', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    mockListForWorkspace.mockResolvedValueOnce([
      { provider: 'openai', status: 'active' },
    ]);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).toContain('openai');
  });

  test('providers not in oauth_connections are unaffected', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    // anthropic has no oauth_connection record at all — should still be used
    mockListForWorkspace.mockResolvedValueOnce([]);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    const providers = mockCreateRuntime.mock.calls.map(([p]) => p);
    expect(providers).toContain('anthropic');
  });

  test('falls back to anthropic when all providers are excluded', async () => {
    mockGetConfig.mockResolvedValueOnce(baseConfig);
    mockListForWorkspace.mockResolvedValueOnce([
      { provider: 'anthropic', status: 'error' },
      { provider: 'openai', status: 'expired' },
    ]);
    await buildWorkspaceRuntime({ workspaceId: 'ws-1' });
    // All providers excluded → strategy select() throws → falls back
    expect(mockCreateRuntime.mock.calls[0][0]).toBe('anthropic');
  });
});
