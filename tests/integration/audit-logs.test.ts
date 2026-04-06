import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { auditLogs } from '../../src/infra/db/schema';

describe('Audit Logs', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Audit Logs Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed some audit log entries
    await testDb.insert(auditLogs).values([
      { workspaceId, actorId: userId, action: 'agent.created', resource: 'agent', resourceId: 'agent-1', metadata: {} },
      { workspaceId, actorId: userId, action: 'settings.updated', resource: 'settings', resourceId: workspaceId, metadata: {} },
      { workspaceId, actorId: userId, action: 'credential.created', resource: 'credential', resourceId: 'cred-1', metadata: {} },
    ]);
  });

  afterAll(async () => {
    await truncateTables('audit_logs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/audit-logs`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET / lists audit logs', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(3);
  });

  it('GET / supports limit parameter', async () => {
    const res = await app.request(`${base()}?limit=2`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(2);
  });

  it('GET / supports action filter', async () => {
    const res = await app.request(`${base()}?action=agent.created`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(1);
    expect(body.data[0].action).toBe('agent.created');
  });

  it('GET /count returns total count', async () => {
    const res = await app.request(`${base()}/count`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.count).toBe(3);
  });
});
