import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { usageRecords } from '../../src/infra/db/schema';

describe('Usage', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Usage Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed usage records
    await testDb.insert(usageRecords).values([
      { workspaceId, model: 'claude-sonnet-4-6', provider: 'anthropic', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: '0.009' },
      { workspaceId, model: 'gpt-4o', provider: 'openai', inputTokens: 2000, outputTokens: 800, totalTokens: 2800, costUsd: '0.020' },
    ]);
  });

  afterAll(async () => {
    await truncateTables('usage_records', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/usage`;
  const hdrs = () => ({ ...authHeader(userId, 'admin') });

  it('GET / returns usage summary', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.totalCostUsd).toBeGreaterThan(0);
    expect(body.data.byModel.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /?period=month scopes to current month', async () => {
    const res = await app.request(`${base()}?period=month`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.totalTokens).toBeDefined();
  });
});
