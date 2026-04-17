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
  recordSuccess,
  recordFailure,
  getHealth,
  setCooldown,
  clearCooldown,
  isInCooldown,
} = await import('../health-store');

const WID = 'ws-health-test';

describe('getHealth', () => {
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

  test('should return zero-valued metrics when hash is empty', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    const health = await getHealth(WID, 'anthropic');

    expect(health.errorCount).toBe(0);
    expect(health.successCount).toBe(0);
    expect(health.totalCalls).toBe(0);
    expect(health.errorRate).toBe(0);
    expect(health.avgLatencyMs).toBe(0);
    expect(health.lastSuccessAt).toBeNull();
    expect(health.lastFailureAt).toBeNull();
    expect(health.cooldownUntil).toBeNull();
  });

  test('should parse stored counts and compute derived fields', async () => {
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({
        errorCount: '2',
        successCount: '8',
        avgLatencyMs: '150.00',
        lastSuccessAt: '1713340800000',
        lastFailureAt: '1713340700000',
      }),
    );

    const health = await getHealth(WID, 'anthropic');

    expect(health.errorCount).toBe(2);
    expect(health.successCount).toBe(8);
    expect(health.totalCalls).toBe(10);
    expect(health.errorRate).toBeCloseTo(0.2);
    expect(health.avgLatencyMs).toBe(150);
    expect(health.lastSuccessAt).toBe(1713340800000);
    expect(health.lastFailureAt).toBe(1713340700000);
  });
});

describe('recordSuccess', () => {
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

  test('should call hmset on the health Redis hash', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    await recordSuccess(WID, 'anthropic', 200);

    expect(mockRedis.hmset).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      expect.objectContaining({ successCount: '1' }),
    );
  });

  test('should set the latency to the first value when no previous calls exist', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    await recordSuccess(WID, 'anthropic', 300);

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    expect(payload?.avgLatencyMs).toBe('300.00');
  });

  test('should apply EMA for latency on subsequent calls', async () => {
    // Existing: 1 success, avgLatencyMs=200
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ successCount: '1', errorCount: '0', avgLatencyMs: '200.00' }),
    );

    await recordSuccess(WID, 'anthropic', 300);

    // EMA: (1 - 0.2) * 200 + 0.2 * 300 = 160 + 60 = 220
    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    expect(parseFloat(payload?.avgLatencyMs ?? '0')).toBeCloseTo(220, 1);
  });

  test('should set an expire on the health key', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    await recordSuccess(WID, 'anthropic', 100);

    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      expect.any(Number),
    );
  });

  test('should increment successCount by 1 from existing value', async () => {
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ successCount: '4', errorCount: '1', avgLatencyMs: '100.00' }),
    );

    await recordSuccess(WID, 'anthropic', 120);

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    expect(payload?.successCount).toBe('5');
  });
});

describe('recordFailure', () => {
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

  test('should increment errorCount on the health hash', async () => {
    mockRedis.hgetall.mockImplementation(() =>
      Promise.resolve({ successCount: '5', errorCount: '2', avgLatencyMs: '150.00' }),
    );

    await recordFailure(WID, 'openai');

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    expect(payload?.errorCount).toBe('3');
    expect(payload?.successCount).toBe('5'); // unchanged
  });

  test('should record errorCount=1 from empty hash', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    await recordFailure(WID, 'openai');

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    expect(payload?.errorCount).toBe('1');
  });

  test('should set lastFailureAt timestamp', async () => {
    mockRedis.hgetall.mockImplementation(() => Promise.resolve({}));

    const before = Date.now();
    await recordFailure(WID, 'openai');
    const after = Date.now();

    const call = mockRedis.hmset.mock.calls[0];
    const payload = call?.[1] as Record<string, string>;
    const lastFailureAt = parseInt(payload?.lastFailureAt ?? '0', 10);

    expect(lastFailureAt).toBeGreaterThanOrEqual(before);
    expect(lastFailureAt).toBeLessThanOrEqual(after);
  });
});

describe('setCooldown', () => {
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

  test('should write cooldownUntil to the health hash', async () => {
    const untilMs = Date.now() + 60_000;

    await setCooldown(WID, 'anthropic', untilMs);

    expect(mockRedis.hset).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      'cooldownUntil',
      String(untilMs),
    );
  });

  test('should set an expire on the health key after writing cooldown', async () => {
    const untilMs = Date.now() + 60_000;

    await setCooldown(WID, 'anthropic', untilMs);

    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      expect.any(Number),
    );
  });
});

describe('clearCooldown', () => {
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

  test('should call hdel on the cooldownUntil field', async () => {
    await clearCooldown(WID, 'anthropic');

    expect(mockRedis.hdel).toHaveBeenCalledWith(
      expect.stringContaining('ai:health:'),
      'cooldownUntil',
    );
  });
});

describe('isInCooldown', () => {
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

  test('should return true when cooldownUntil is in the future', async () => {
    const futureMs = Date.now() + 30_000;
    mockRedis.hget.mockImplementation(() => Promise.resolve(String(futureMs)));

    const result = await isInCooldown(WID, 'anthropic');

    expect(result).toBe(true);
  });

  test('should return false when cooldownUntil is in the past', async () => {
    const pastMs = Date.now() - 30_000;
    mockRedis.hget.mockImplementation(() => Promise.resolve(String(pastMs)));

    const result = await isInCooldown(WID, 'anthropic');

    expect(result).toBe(false);
  });

  test('should return false when cooldownUntil is not set', async () => {
    mockRedis.hget.mockImplementation(() => Promise.resolve(null));

    const result = await isInCooldown(WID, 'anthropic');

    expect(result).toBe(false);
  });
});
