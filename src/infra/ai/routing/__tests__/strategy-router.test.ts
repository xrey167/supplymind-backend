import { describe, test, expect } from 'bun:test';
import { StrategyRouter } from '../strategy-router';
import type { RoutingConfig } from '../types';

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
  test('priority strategy returns first provider', () => {
    const router = new StrategyRouter(config);
    expect(router.select().provider).toBe('anthropic');
  });

  test('priority strategy excludes provider and falls back', () => {
    const router = new StrategyRouter(config);
    expect(router.select(new Set(['anthropic'])).provider).toBe('openai');
  });

  test('round-robin increments counter and cycles', () => {
    const router = new StrategyRouter({ ...config, strategy: 'round-robin', roundRobinCounter: 0 });
    expect(router.select().provider).toBe('anthropic');
    expect(router.select().provider).toBe('openai');
    expect(router.select().provider).toBe('anthropic'); // wraps
  });

  test('cost-optimized picks openai (cheaper)', () => {
    const router = new StrategyRouter({ ...config, strategy: 'cost-optimized' });
    expect(router.select().provider).toBe('openai');
  });

  test('weighted returns a valid provider', () => {
    const router = new StrategyRouter({ ...config, strategy: 'weighted' });
    const target = router.select();
    expect(['anthropic', 'openai']).toContain(target.provider);
  });

  test('throws when all providers excluded', () => {
    const router = new StrategyRouter(config);
    expect(() => router.select(new Set(['anthropic', 'openai']))).toThrow('No available provider');
  });
});
