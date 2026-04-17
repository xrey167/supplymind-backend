import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockCreateRuntime = mock((provider: string, mode: string) => ({
  provider,
  mode,
  run: async () => ({ ok: true as const, value: { content: '' } }),
  async *stream() { }
}));

const mockWithFallbackRuntime = mock((runtimes: unknown[]) => (runtimes[0] as any));
const mockGetConfig = mock(async () => null as any);
const mockIncrementRoundRobinCounter = mock(async () => {});

mock.module('../../runtime-factory', () => ({
  createRuntime: mockCreateRuntime,
  withFallbackRuntime: mockWithFallbackRuntime,
}));

mock.module('../../../../modules/routing-config/routing-config.service', () => ({
  routingConfigService: { getConfig: mockGetConfig },
}));

mock.module('../../../../modules/routing-config/routing-config.repo', () => ({
  routingConfigRepo: { incrementRoundRobinCounter: mockIncrementRoundRobinCounter },
}));

const { buildWorkspaceRuntime } = await import('../workspace-runtime');

describe('buildWorkspaceRuntime', () => {
  beforeEach(() => {
    mockCreateRuntime.mockClear();
    mockWithFallbackRuntime.mockClear();
    mockGetConfig.mockReset();
    mockIncrementRoundRobinCounter.mockClear();
  });

  test('does not include excluded providers in fallback runtimes', async () => {
    mockGetConfig.mockResolvedValueOnce({
      id: 'rc-1',
      workspaceId: 'ws-1',
      strategy: 'priority',
      roundRobinCounter: 0,
      updatedAt: new Date(),
      providers: [
        { provider: 'anthropic', model: 'claude', weight: 50, costPer1kTokens: 0.003, mode: 'raw' },
        { provider: 'openai', model: 'gpt-5', weight: 50, costPer1kTokens: 0.002, mode: 'raw' },
      ],
    });

    await buildWorkspaceRuntime({ workspaceId: 'ws-1', excludedProviders: ['openai'] });

    const providers = mockCreateRuntime.mock.calls.map(([provider]) => provider);
    expect(providers).toEqual(['anthropic']);
  });
});
