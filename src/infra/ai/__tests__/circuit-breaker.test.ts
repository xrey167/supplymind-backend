import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockRedis = {
  hgetall: mock(() => Promise.resolve({})),
  hset: mock(() => Promise.resolve(1)),
  hmset: mock(() => Promise.resolve('OK')),
  expire: mock(() => Promise.resolve(1)),
  hget: mock(() => Promise.resolve(null)),
  hdel: mock(() => Promise.resolve(1)),
};

mock.module('../../redis/client', () => ({
  getSharedRedisClient: () => mockRedis,
}));

const {
  getCircuitState,
  openCircuit,
  closeCircuit,
  evaluateCircuit,
  getOpenProviders,
} = await import('../circuit-breaker');

const WID = 'ws-test';

describe('getCircuitState', () => {
  beforeEach(() => {
    mockRedis.hgetall.mockReset();
    mockRedis.hset.mockReset();
    mockRedis.hmset.mockReset();
    mockRedis.expire.mockReset();
    mockRedis.hget.mockReset();
    mockRedis.hdel.mockReset();
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));
    mockRedis.hset.mockImplementation(() => Promise.resolve(1));
    mockRedis.hmset.mockImplementation(() => Promise.resolve('OK'));
    mockRedis.expire.mockImplementation(() => Promise.resolve(1));
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));
    mockRedis.hdel.mockImplementation(() => Promise.resolve(1));
  });

  test('should return closed when hash is empty', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    const state = await getCircuitState(WID, 'anthropic');

    expect(state).toBe('closed');
  });

  test('should return open when state is open and within cooldown window', async () => {
    const recentlyOpened = String(Date.now() - 10_000); // 10s ago, default cooldown is 60s
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ state: 'open', openedAt: recentlyOpened }),
    );

    const state = await getCircuitState(WID, 'anthropic');

    expect(state).toBe('open');
  });

  test('should transition to half_open when openedAt is past cooldownMs', async () => {
    const longAgo = String(Date.now() - 70_000); // 70s ago, past default 60s cooldown
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ state: 'open', openedAt: longAgo }),
    );

    const state = await getCircuitState(WID, 'anthropic');

    expect(state).toBe('half_open');
    expect(mockRedis.hset).toHaveBeenCalledWith(
      expect.stringContaining('circuit:'),
      'state',
      'half_open',
      'halfOpenAttempts',
      '0',
    );
  });

  test('should return half_open when state is already half_open', async () => {
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ state: 'half_open', openedAt: String(Date.now()) }),
    );

    const state = await getCircuitState(WID, 'anthropic');

    expect(state).toBe('half_open');
  });
});

describe('openCircuit', () => {
  beforeEach(() => {
    mockRedis.hgetall.mockReset();
    mockRedis.hset.mockReset();
    mockRedis.hmset.mockReset();
    mockRedis.expire.mockReset();
    mockRedis.hget.mockReset();
    mockRedis.hdel.mockReset();
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));
    mockRedis.hset.mockImplementation(() => Promise.resolve(1));
    mockRedis.hmset.mockImplementation(() => Promise.resolve('OK'));
    mockRedis.expire.mockImplementation(() => Promise.resolve(1));
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));
    mockRedis.hdel.mockImplementation(() => Promise.resolve(1));
  });

  test('should write state=open to Redis', async () => {
    await openCircuit(WID, 'openai');

    expect(mockRedis.hmset).toHaveBeenCalledWith(
      expect.stringContaining('circuit:'),
      expect.objectContaining({ state: 'open' }),
    );
  });

  test('should include openedAt timestamp in Redis hash', async () => {
    const before = Date.now();
    await openCircuit(WID, 'openai');
    const after = Date.now();

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    const openedAt = parseInt(payload?.openedAt ?? '0', 10);

    expect(openedAt).toBeGreaterThanOrEqual(before);
    expect(openedAt).toBeLessThanOrEqual(after);
  });
});

describe('closeCircuit', () => {
  beforeEach(() => {
    mockRedis.hgetall.mockReset();
    mockRedis.hset.mockReset();
    mockRedis.hmset.mockReset();
    mockRedis.expire.mockReset();
    mockRedis.hget.mockReset();
    mockRedis.hdel.mockReset();
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));
    mockRedis.hset.mockImplementation(() => Promise.resolve(1));
    mockRedis.hmset.mockImplementation(() => Promise.resolve('OK'));
    mockRedis.expire.mockImplementation(() => Promise.resolve(1));
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));
    mockRedis.hdel.mockImplementation(() => Promise.resolve(1));
  });

  test('should set state=closed in Redis', async () => {
    await closeCircuit(WID, 'openai');

    expect(mockRedis.hset).toHaveBeenCalledWith(
      expect.stringContaining('circuit:'),
      'state',
      'closed',
    );
  });

  test('should clear the cooldown key', async () => {
    await closeCircuit(WID, 'openai');

    expect(mockRedis.hdel).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      'cooldownUntil',
    );
  });
});

describe('evaluateCircuit', () => {
  beforeEach(() => {
    mockRedis.hgetall.mockReset();
    mockRedis.hset.mockReset();
    mockRedis.hmset.mockReset();
    mockRedis.expire.mockReset();
    mockRedis.hget.mockReset();
    mockRedis.hdel.mockReset();
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));
    mockRedis.hset.mockImplementation(() => Promise.resolve(1));
    mockRedis.hmset.mockImplementation(() => Promise.resolve('OK'));
    mockRedis.expire.mockImplementation(() => Promise.resolve(1));
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));
    mockRedis.hdel.mockImplementation(() => Promise.resolve(1));
  });

  test('should open circuit when totalCalls>=5 and errorRate>=0.5', async () => {
    // errorCount=3, successCount=2 → totalCalls=5, errorRate=0.6
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ errorCount: '3', successCount: '2' }),
    );

    await evaluateCircuit(WID, 'anthropic');

    expect(mockRedis.hmset).toHaveBeenCalledWith(
      expect.stringContaining('circuit:'),
      expect.objectContaining({ state: 'open' }),
    );
  });

  test('should NOT open circuit when totalCalls<5', async () => {
    // errorCount=2, successCount=1 → totalCalls=3, below minCallsBeforeOpen=5
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ errorCount: '2', successCount: '1' }),
    );

    await evaluateCircuit(WID, 'anthropic');

    const hmsetCallsWithOpen = mockRedis.hmset.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        (call[1] as Record<string, string>).state === 'open',
    );
    expect(hmsetCallsWithOpen).toHaveLength(0);
  });

  test('should NOT open circuit when errorRate<0.5 even with enough calls', async () => {
    // errorCount=2, successCount=8 → totalCalls=10, errorRate=0.2
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ errorCount: '2', successCount: '8' }),
    );

    await evaluateCircuit(WID, 'anthropic');

    const hmsetCallsWithOpen = mockRedis.hmset.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        (call[1] as Record<string, string>).state === 'open',
    );
    expect(hmsetCallsWithOpen).toHaveLength(0);
  });
});

describe('getOpenProviders', () => {
  beforeEach(() => {
    mockRedis.hgetall.mockReset();
    mockRedis.hset.mockReset();
    mockRedis.hmset.mockReset();
    mockRedis.expire.mockReset();
    mockRedis.hget.mockReset();
    mockRedis.hdel.mockReset();
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));
    mockRedis.hset.mockImplementation(() => Promise.resolve(1));
    mockRedis.hmset.mockImplementation(() => Promise.resolve('OK'));
    mockRedis.expire.mockImplementation(() => Promise.resolve(1));
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));
    mockRedis.hdel.mockImplementation(() => Promise.resolve(1));
  });

  test('should return only providers with state=open and within cooldown', async () => {
    const recentlyOpened = String(Date.now() - 5_000); // 5s ago, within default 60s cooldown

    mockRedis.hgetall.mockImplementation((key: string) => {
      if (key.includes(':providerA')) {
        return Promise.resolve({ state: 'open', openedAt: recentlyOpened });
      }
      // providerB has no state — closed
      return Promise.resolve({});
    });

    const open = await getOpenProviders(WID, ['providerA', 'providerB']);

    expect(open.has('providerA')).toBe(true);
    expect(open.has('providerB')).toBe(false);
  });

  test('should return empty set when no providers are open', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    const open = await getOpenProviders(WID, ['anthropic', 'openai', 'google']);

    expect(open.size).toBe(0);
  });

  test('should exclude half_open providers from the open set', async () => {
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ state: 'half_open' }),
    );

    const open = await getOpenProviders(WID, ['anthropic']);

    expect(open.has('anthropic')).toBe(false);
  });
});
