import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock the Redis client BEFORE importing rate-limit so getRedis() uses it
// ---------------------------------------------------------------------------
const mockRateLimitCheck = mock(() => Promise.resolve([1, 9, Date.now() - 1000] as [number, number, number]));
const mockDefineCommand = mock(() => {});

const _realRedisClient = require('../../../infra/redis/client');
mock.module('../../../infra/redis/client', () => ({
  ..._realRedisClient,
  getSharedRedisClient: () => ({
    rateLimitCheck: mockRateLimitCheck,
    defineCommand: mockDefineCommand,
  }),
}));

// Import AFTER mocks are registered
const { rateLimit, _resetBuckets } = await import('../rate-limit');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function createApp(maxRequests: number) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as any).set('workspaceId', 'ws-test');
    return next();
  });
  app.use('*', rateLimit(maxRequests));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('rateLimit middleware (Redis-backed)', () => {
  beforeEach(() => {
    // Reset the defineCommand registration flag so defineCommand is called fresh
    _resetBuckets();
    mockRateLimitCheck.mockClear();
    mockDefineCommand.mockClear();
  });

  it('allows requests when Redis returns allowed=1', async () => {
    mockRateLimitCheck.mockResolvedValueOnce([1, 9, Date.now() - 1000]);
    const app = createApp(10);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  it('returns 429 when Redis returns allowed=0', async () => {
    mockRateLimitCheck.mockResolvedValueOnce([0, 0, Date.now() - 30000]);
    const app = createApp(10);
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Too many requests');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('fails open (allows request) when Redis throws', async () => {
    mockRateLimitCheck.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const app = createApp(10);
    const res = await app.request('/test');
    // Fail-open: should allow the request
    expect(res.status).toBe(200);
  });

  it('sets X-RateLimit headers on success', async () => {
    mockRateLimitCheck.mockResolvedValueOnce([1, 4, Date.now() - 1000]);
    const app = createApp(5);
    const res = await app.request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('calls rateLimitCheck with correct key format', async () => {
    mockRateLimitCheck.mockResolvedValueOnce([1, 199, Date.now() - 100]);
    const app = createApp(200);
    await app.request('/test');
    // The workspaceId is set to 'ws-test' in createApp; key must be 'rl:ws-test'
    expect(mockRateLimitCheck).toHaveBeenCalledWith(
      'rl:ws-test',
      '200',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });
});
