import { describe, test, expect } from 'bun:test';
import { StrategyRouter } from '../strategy-router';
import type { RoutingConfig } from '../types';
// Side-effect import: ensures all built-in strategies are registered
import '../strategies';

const config: RoutingConfig = {
  id: 'rc-1',
  workspaceId: 'ws-1',
  strategy: 'priority',
  roundRobinCounter: 0,
  updatedAt: new Date(),
  providers: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6',   weight: 60, costPer1kTokens: 0.003 },
    { provider: 'openai',    model: 'gpt-4o-mini',          weight: 40, costPer1kTokens: 0.0015 },
  ],
};

describe('StrategyRouter.select', () => {
  test('priority strategy returns first provider', async () => {
    const router = new StrategyRouter(config);
    expect((await router.select()).provider).toBe('anthropic');
  });

  test('priority strategy excludes provider and falls back', async () => {
    const router = new StrategyRouter(config);
    expect((await router.select(new Set(['anthropic']))).provider).toBe('openai');
  });

  test('round-robin increments counter and cycles', async () => {
    const router = new StrategyRouter({ ...config, strategy: 'round-robin', roundRobinCounter: 0 });
    expect((await router.select()).provider).toBe('anthropic');
    expect((await router.select()).provider).toBe('openai');
    expect((await router.select()).provider).toBe('anthropic'); // wraps
  });

  test('cost-optimized picks openai (cheaper)', async () => {
    const router = new StrategyRouter({ ...config, strategy: 'cost-optimized' });
    expect((await router.select()).provider).toBe('openai');
  });

  test('weighted returns a valid provider', async () => {
    const router = new StrategyRouter({ ...config, strategy: 'weighted' });
    const target = await router.select();
    expect(['anthropic', 'openai']).toContain(target.provider);
  });

  test('throws when all providers excluded', async () => {
    const router = new StrategyRouter(config);
    await expect(router.select(new Set(['anthropic', 'openai']))).rejects.toThrow('No available provider');
  });
});
