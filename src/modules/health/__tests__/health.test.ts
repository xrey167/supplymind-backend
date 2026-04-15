import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockExecute = mock(() => Promise.resolve([{ '?column?': 1 }]));
mock.module('../../../infra/db/client', () => ({
  db: { execute: mockExecute },
}));

const mockPing = mock(() => Promise.resolve('PONG'));
mock.module('../../../infra/redis/client', () => ({
  getSharedRedisClient: () => ({ ping: mockPing }),
}));

const { healthService } = await import('../health.service');

describe('healthService', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockReset();
    mockPing.mockResolvedValue('PONG');
  });

  it('returns ready when all checks pass', async () => {
    const result = await healthService.readiness();
    expect(result.status).toBe('ready');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('ok');
  });

  it('returns degraded when DB fails', async () => {
    mockExecute.mockRejectedValue(new Error('connection refused'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('error');
    expect(result.checks.redis).toBe('ok');
  });

  it('returns degraded when Redis fails', async () => {
    mockPing.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('error');
  });

  it('returns degraded when both fail', async () => {
    mockExecute.mockRejectedValue(new Error('db down'));
    mockPing.mockRejectedValue(new Error('redis down'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('error');
    expect(result.checks.redis).toBe('error');
  });
});

afterAll(() => mock.restore());
