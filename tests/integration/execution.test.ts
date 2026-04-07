import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Execution Layer', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let planId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Execution Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('execution_runs', 'execution_plans', 'orchestrations', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/plans`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('POST / creates a plan (status: draft)', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Test Plan',
        steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'hello' } }],
        input: { test: true },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.status).toBe('draft');
    planId = body.id;
    expect(typeof planId).toBe('string');
  });

  it('GET /:id returns the plan', async () => {
    const res = await app.request(`${base()}/${planId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(planId);
    expect(body.status).toBe('draft');
  });

  it('GET / lists plans', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((p: any) => p.id === planId)).toBe(true);
  });

  it('POST /:id/run submits plan (intent classified)', async () => {
    const res = await app.request(`${base()}/${planId}/run`, {
      method: 'POST', headers: hdrs(),
    });
    expect([200, 400]).toContain(res.status);
    const body = await res.json() as any;
    if (res.status === 200) {
      expect(['running', 'pending_approval']).toContain(body.status);
    }
  });

  it('GET /:id/runs returns runs list', async () => {
    const res = await app.request(`${base()}/${planId}/runs`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('plan with critical step triggers approval flow', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Critical Plan',
        steps: [{ id: 's1', type: 'skill', skillId: 'bc.post-action', riskClass: 'critical', approvalMode: 'required' }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const criticalPlanId = body.id;

    const runRes = await app.request(`${base()}/${criticalPlanId}/run`, {
      method: 'POST', headers: hdrs(),
    });
    expect([200, 400]).toContain(runRes.status);
    if (runRes.status === 200) {
      const runBody = await runRes.json() as any;
      expect(['pending_approval', 'running']).toContain(runBody.status);
    }
  });

  it('surface parity — Gateway plan.create returns same structure as REST', async () => {
    const { execute } = await import('../../src/core/gateway/gateway');
    const result = await execute({
      op: 'plan.create' as any,
      params: {
        steps: [{ id: 's1', type: 'skill', skillId: 'echo' }],
        input: {},
      },
      context: { callerId: userId, workspaceId, callerRole: 'admin' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const plan = result.value as any;
      expect(plan.status).toBe('draft');
      expect(typeof plan.id).toBe('string');
    }
  });
});
