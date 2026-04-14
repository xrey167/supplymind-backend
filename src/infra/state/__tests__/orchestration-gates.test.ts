import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

// ---------------------------------------------------------------------------
// Mock Redis — we control get/set/scan independently per test
// ---------------------------------------------------------------------------
const mockGet = mock(async (_key: string): Promise<string | null> => null);
const mockSet = mock(async (..._args: unknown[]): Promise<'OK'> => 'OK');
const mockScan = mock(async (_cursor: string, ..._args: unknown[]): Promise<[string, string[]]> => ['0', []]);

mock.module('../../../infra/redis/client', () => ({
  getSharedRedisClient: () => ({
    get: mockGet,
    set: mockSet,
    scan: mockScan,
  }),
}));

// ---------------------------------------------------------------------------
// Mock gate-audit.repo — track insert calls
// ---------------------------------------------------------------------------
const mockAuditInsert = mock(async (_record: unknown): Promise<void> => undefined);

mock.module('../gate-audit.repo', () => ({
  gateAuditRepo: {
    insert: mockAuditInsert,
    listByOrchestration: mock(async () => []),
  },
}));

// ---------------------------------------------------------------------------
// Import module AFTER mocks are registered
// ---------------------------------------------------------------------------
const {
  createGateRequest,
  resolveGate,
  pendingGateCount,
  gateKey,
  recoverPendingGates,
  listPendingGates,
} = await import('../orchestration-gates');

async function flush() {
  // Flush microtasks + one macrotask tick so fire-and-forget Promises settle
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function resetMocks() {
  // mockRestore is not available in bun:test for mock() functions created inline;
  // use mockReset to clear call counts AND queued mockImplementationOnce entries.
  mockGet.mockReset();
  mockSet.mockReset();
  mockScan.mockReset();
  mockAuditInsert.mockReset();
  // Re-install default implementations after reset
  mockGet.mockImplementation(async (_key: string): Promise<string | null> => null);
  mockSet.mockImplementation(async (..._args: unknown[]): Promise<'OK'> => 'OK');
  mockScan.mockImplementation(async (_cursor: string, ..._args: unknown[]): Promise<[string, string[]]> => ['0', []]);
  mockAuditInsert.mockImplementation(async (_record: unknown): Promise<void> => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('orchestration-gates', () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // gateKey
  // -------------------------------------------------------------------------
  describe('gateKey', () => {
    it('builds composite key', () => {
      expect(gateKey('orch-1', 'step-1')).toBe('orch-1:step-1');
    });
  });

  // -------------------------------------------------------------------------
  // createGateRequest — Redis writes
  // -------------------------------------------------------------------------
  describe('createGateRequest — Redis persistence', () => {
    it('writes to Redis with correct key pattern and status pending', async () => {
      const promise = createGateRequest('orch-redis-1', 'step-1', 'ws-a', 5000, 'Please approve');

      // Resolve immediately so the promise doesn't linger
      resolveGate('orch-redis-1', 'step-1', 'ws-a', true, 'user-1');
      await promise;
      await flush();

      // Redis.set should have been called with the gate key
      const setCall = mockSet.mock.calls.find((c) => typeof c[0] === 'string' && (c[0] as string).startsWith('gate:orch-redis-1:step-1'));
      expect(setCall).toBeDefined();

      const written = JSON.parse(setCall![1] as string);
      expect(written.orchestrationId).toBe('orch-redis-1');
      expect(written.stepId).toBe('step-1');
      expect(written.workspaceId).toBe('ws-a');
      expect(written.prompt).toBe('Please approve');
      expect(written.status).toBe('pending');
      expect(typeof written.createdAt).toBe('string');
      expect(typeof written.timeoutAt).toBe('string');

      // TTL should be 'EX' followed by a positive number
      expect(setCall![2]).toBe('EX');
      expect(Number(setCall![3])).toBeGreaterThan(0);
    });

    it('uses default prompt when none is provided', async () => {
      const promise = createGateRequest('orch-redis-def', 'step-1', 'ws-a', 5000);
      resolveGate('orch-redis-def', 'step-1', 'ws-a', true, 'u');
      await promise;
      await flush();

      const setCall = mockSet.mock.calls.find((c) => typeof c[0] === 'string' && (c[0] as string).startsWith('gate:orch-redis-def'));
      expect(setCall).toBeDefined();
      const written = JSON.parse(setCall![1] as string);
      expect(written.prompt).toBe('Approval required to continue');
    });

    it('Redis failure in createGateRequest is swallowed — gate still resolves normally', async () => {
      mockSet.mockImplementationOnce(async () => { throw new Error('Redis down'); });

      const promise = createGateRequest('orch-err', 'step-1', 'ws-b', 5000, 'hi');
      resolveGate('orch-err', 'step-1', 'ws-b', true, 'u');
      // Gate must resolve even when Redis throws
      await expect(promise).resolves.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // resolveGate — Redis updates
  // -------------------------------------------------------------------------
  describe('resolveGate — Redis updates', () => {
    it('happy path: resolves to true when approved and updates Redis to approved', async () => {
      const raw = JSON.stringify({
        orchestrationId: 'orch-res-1', stepId: 'step-1', workspaceId: 'ws-1',
        prompt: 'ok', createdAt: '', timeoutAt: '', status: 'pending',
      });
      mockGet.mockImplementationOnce(async () => raw);

      const promise = createGateRequest('orch-res-1', 'step-1', 'ws-1', 5000, 'ok');
      const resolved = resolveGate('orch-res-1', 'step-1', 'ws-1', true, 'user-123');

      expect(resolved).toBe(true);
      await expect(promise).resolves.toBe(true);
      await flush();

      // After resolveGate, redis.get then redis.set with status approved
      const setCallApproved = mockSet.mock.calls.find((c) => {
        if (typeof c[1] !== 'string') return false;
        try { return JSON.parse(c[1] as string).status === 'approved'; } catch { return false; }
      });
      expect(setCallApproved).toBeDefined();
      const updated = JSON.parse(setCallApproved![1] as string);
      expect(updated.status).toBe('approved');
      expect(updated.decidedBy).toBe('user-123');
      expect(typeof updated.decidedAt).toBe('string');
    });

    it('denial path: resolves to false and updates Redis to rejected', async () => {
      const raw = JSON.stringify({
        orchestrationId: 'orch-res-2', stepId: 'step-1', workspaceId: 'ws-1',
        prompt: 'ok', createdAt: '', timeoutAt: '', status: 'pending',
      });
      mockGet.mockImplementationOnce(async () => raw);

      const promise = createGateRequest('orch-res-2', 'step-1', 'ws-1', 5000, 'ok');
      resolveGate('orch-res-2', 'step-1', 'ws-1', false, 'user-456');

      await expect(promise).resolves.toBe(false);
      await flush();

      const setCallRejected = mockSet.mock.calls.find((c) => {
        if (typeof c[1] !== 'string') return false;
        try { return JSON.parse(c[1] as string).status === 'rejected'; } catch { return false; }
      });
      expect(setCallRejected).toBeDefined();
      const updated = JSON.parse(setCallRejected![1] as string);
      expect(updated.status).toBe('rejected');
      expect(updated.decidedBy).toBe('user-456');
    });

    it('Redis failure in resolveGate is swallowed', async () => {
      mockGet.mockImplementationOnce(async () => { throw new Error('Redis down'); });

      const promise = createGateRequest('orch-res-err', 'step-1', 'ws-1', 5000, 'hi');
      const resolved = resolveGate('orch-res-err', 'step-1', 'ws-1', true, 'u');
      expect(resolved).toBe(true);
      // Must still resolve normally
      await expect(promise).resolves.toBe(true);
    });

    it('timeout: resolves to false after timeoutMs and updates Redis to timeout', async () => {
      const raw = JSON.stringify({
        orchestrationId: 'orch-timeout-r', stepId: 'step-1', workspaceId: 'ws-1',
        prompt: 'ok', createdAt: '', timeoutAt: '', status: 'pending',
      });
      mockGet.mockImplementationOnce(async () => raw);

      const promise = createGateRequest('orch-timeout-r', 'step-1', 'ws-1', 1, 'ok');

      await new Promise<void>((r) => setTimeout(r, 20));

      await expect(promise).resolves.toBe(false);
      await flush();

      const setCallTimeout = mockSet.mock.calls.find((c) => {
        if (typeof c[1] !== 'string') return false;
        try { return JSON.parse(c[1] as string).status === 'timeout'; } catch { return false; }
      });
      expect(setCallTimeout).toBeDefined();
      const updated = JSON.parse(setCallTimeout![1] as string);
      expect(updated.status).toBe('timeout');
      expect(updated.decidedBy).toBe('system');
    });

    it('cross-workspace rejection', async () => {
      let resolved = false;
      const promise = createGateRequest('orch-cross-r', 'step-1', 'ws-correct', 5000, 'hi');
      promise.then(() => { resolved = true; });

      const returnValue = resolveGate('orch-cross-r', 'step-1', 'ws-wrong', true, 'u');

      await flush();

      expect(returnValue).toBe(false);
      expect(resolved).toBe(false);

      // Clean up
      resolveGate('orch-cross-r', 'step-1', 'ws-correct', false, 'u');
      await promise;
    });

    it('cleanup: after resolving, a second resolve returns false', async () => {
      const promise = createGateRequest('orch-cleanup-r', 'step-1', 'ws-1', 5000, 'hi');

      resolveGate('orch-cleanup-r', 'step-1', 'ws-1', true, 'u');
      await promise;

      expect(resolveGate('orch-cleanup-r', 'step-1', 'ws-1', true, 'u')).toBe(false);
    });

    it('count tracks pending gates', async () => {
      const before = pendingGateCount();
      const promise = createGateRequest('orch-count-r', 'step-1', 'ws-1', 5000, 'hi');
      expect(pendingGateCount()).toBe(before + 1);

      resolveGate('orch-count-r', 'step-1', 'ws-1', true, 'u');
      await promise;

      expect(pendingGateCount()).toBe(before);
    });

    it('returns false when gate does not exist', () => {
      expect(resolveGate('nonexistent', 'step-x', 'ws-1', true, 'u')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // recoverPendingGates
  // -------------------------------------------------------------------------
  describe('recoverPendingGates', () => {
    it('marks pending gates as timeout on scan', async () => {
      const pendingMeta = JSON.stringify({
        orchestrationId: 'orch-recover', stepId: 'step-1', workspaceId: 'ws-1',
        prompt: 'approve?', createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + 5000).toISOString(),
        status: 'pending',
      });

      // scan returns one key on the first (and only) call; cursor '0' exits the loop immediately
      mockScan
        .mockImplementationOnce(async () => ['0', ['gate:orch-recover:step-1']] as [string, string[]]);

      mockGet.mockImplementationOnce(async (_key: string) => pendingMeta);

      await recoverPendingGates();
      await flush();

      // Should have called set with status: timeout
      const setCallTimeout = mockSet.mock.calls.find((c) => {
        if (typeof c[1] !== 'string') return false;
        try { return JSON.parse(c[1] as string).status === 'timeout'; } catch { return false; }
      });
      expect(setCallTimeout).toBeDefined();
      const updated = JSON.parse(setCallTimeout![1] as string);
      expect(updated.status).toBe('timeout');
      expect(updated.decidedBy).toBe('system');
    });

    it('skips non-pending gates during recovery', async () => {
      const approvedMeta = JSON.stringify({
        orchestrationId: 'orch-skip', stepId: 'step-1', workspaceId: 'ws-1',
        prompt: 'done', createdAt: '', timeoutAt: '', status: 'approved',
        decidedBy: 'user-1', decidedAt: new Date().toISOString(),
      });

      mockScan.mockImplementationOnce(async () => ['0', ['gate:orch-skip:step-1']] as [string, string[]]);
      mockGet.mockImplementationOnce(async () => approvedMeta);

      const setCountBefore = mockSet.mock.calls.length;
      await recoverPendingGates();
      await flush();

      // No additional set calls — approved gate should not be touched
      expect(mockSet.mock.calls.length).toBe(setCountBefore);
    });

    it('handles empty scan result without error', async () => {
      mockScan.mockImplementationOnce(async () => ['0', []] as [string, string[]]);
      await expect(recoverPendingGates()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // listPendingGates
  // -------------------------------------------------------------------------
  describe('listPendingGates', () => {
    const ws1Meta = JSON.stringify({
      orchestrationId: 'orch-list-1', stepId: 'step-1', workspaceId: 'ws-list-1',
      prompt: 'approve?', createdAt: '', timeoutAt: '', status: 'pending',
    });
    const ws2Meta = JSON.stringify({
      orchestrationId: 'orch-list-2', stepId: 'step-1', workspaceId: 'ws-list-2',
      prompt: 'approve?', createdAt: '', timeoutAt: '', status: 'pending',
    });
    const approvedMeta = JSON.stringify({
      orchestrationId: 'orch-list-3', stepId: 'step-1', workspaceId: 'ws-list-1',
      prompt: 'done', createdAt: '', timeoutAt: '', status: 'approved',
    });

    it('returns all pending gates when no workspaceId filter', async () => {
      mockScan.mockImplementationOnce(async () => [
        '0',
        ['gate:orch-list-1:step-1', 'gate:orch-list-2:step-1', 'gate:orch-list-3:step-1'],
      ] as [string, string[]]);
      mockGet
        .mockImplementationOnce(async () => ws1Meta)
        .mockImplementationOnce(async () => ws2Meta)
        .mockImplementationOnce(async () => approvedMeta);

      const result = await listPendingGates();
      // Only the 2 pending gates, not the approved one
      expect(result).toHaveLength(2);
      expect(result.map(r => r.orchestrationId).sort()).toEqual(['orch-list-1', 'orch-list-2']);
    });

    it('filters by workspaceId', async () => {
      mockScan.mockImplementationOnce(async () => [
        '0',
        ['gate:orch-list-1:step-1', 'gate:orch-list-2:step-1'],
      ] as [string, string[]]);
      mockGet
        .mockImplementationOnce(async () => ws1Meta)
        .mockImplementationOnce(async () => ws2Meta);

      const result = await listPendingGates('ws-list-1');
      expect(result).toHaveLength(1);
      expect(result[0].workspaceId).toBe('ws-list-1');
      expect(result[0].orchestrationId).toBe('orch-list-1');
    });

    it('returns empty array when no pending gates exist', async () => {
      mockScan.mockImplementationOnce(async () => ['0', []] as [string, string[]]);
      const result = await listPendingGates();
      expect(result).toHaveLength(0);
    });

    it('skips keys where Redis.get returns null', async () => {
      mockScan.mockImplementationOnce(async () => ['0', ['gate:missing:step-1']] as [string, string[]]);
      mockGet.mockImplementationOnce(async () => null);
      const result = await listPendingGates();
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Gate Audit Log — integration with orchestration-gates
  // -------------------------------------------------------------------------
  describe('gate audit writes', () => {
    it('calls gateAuditRepo.insert with outcome:approved after resolveGate(approved=true)', async () => {
      const promise = createGateRequest('orch-audit-1', 'step-1', 'ws-audit', 5000, 'audit approve test');
      resolveGate('orch-audit-1', 'step-1', 'ws-audit', true, 'user-audit');
      await promise;
      await flush();

      const insertCall = mockAuditInsert.mock.calls.find((c) => {
        const rec = c[0] as Record<string, unknown>;
        return rec.orchestrationId === 'orch-audit-1' && rec.outcome === 'approved';
      });
      expect(insertCall).toBeDefined();
      const rec = insertCall![0] as Record<string, unknown>;
      expect(rec.outcome).toBe('approved');
      expect(rec.decidedBy).toBe('user-audit');
      expect(rec.workspaceId).toBe('ws-audit');
      expect(rec.prompt).toBe('audit approve test');
      expect(rec.stepId).toBe('step-1');
    });

    it('calls gateAuditRepo.insert with outcome:rejected after resolveGate(approved=false)', async () => {
      const promise = createGateRequest('orch-audit-2', 'step-1', 'ws-audit', 5000, 'audit reject test');
      resolveGate('orch-audit-2', 'step-1', 'ws-audit', false, 'user-audit-2');
      await promise;
      await flush();

      const insertCall = mockAuditInsert.mock.calls.find((c) => {
        const rec = c[0] as Record<string, unknown>;
        return rec.orchestrationId === 'orch-audit-2' && rec.outcome === 'rejected';
      });
      expect(insertCall).toBeDefined();
      const rec = insertCall![0] as Record<string, unknown>;
      expect(rec.outcome).toBe('rejected');
      expect(rec.decidedBy).toBe('user-audit-2');
    });

    it('calls gateAuditRepo.insert with outcome:timeout after gate times out', async () => {
      const promise = createGateRequest('orch-audit-timeout', 'step-1', 'ws-audit', 1, 'timeout audit test');
      await new Promise<void>((r) => setTimeout(r, 20));
      await promise;
      await flush();

      const insertCall = mockAuditInsert.mock.calls.find((c) => {
        const rec = c[0] as Record<string, unknown>;
        return rec.orchestrationId === 'orch-audit-timeout' && rec.outcome === 'timeout';
      });
      expect(insertCall).toBeDefined();
      const rec = insertCall![0] as Record<string, unknown>;
      expect(rec.outcome).toBe('timeout');
      expect(rec.decidedBy).toBe('system');
      expect(rec.workspaceId).toBe('ws-audit');
      expect(rec.prompt).toBe('timeout audit test');
    });

    it('gateAuditRepo.insert failure is swallowed — resolveGate still returns true', async () => {
      mockAuditInsert.mockImplementation(async () => { throw new Error('audit DB down'); });

      const promise = createGateRequest('orch-audit-err', 'step-1', 'ws-audit', 5000, 'audit err test');
      const resolved = resolveGate('orch-audit-err', 'step-1', 'ws-audit', true, 'user-x');

      expect(resolved).toBe(true);
      await expect(promise).resolves.toBe(true);
      // No unhandled rejection should occur
    });

    it('calls gateAuditRepo.insert with outcome:timeout for each recovered gate', async () => {
      const pendingMeta = JSON.stringify({
        orchestrationId: 'orch-recover-audit', stepId: 'step-1', workspaceId: 'ws-recover',
        prompt: 'recover?', createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + 5000).toISOString(),
        status: 'pending',
      });

      mockScan.mockImplementationOnce(async () => ['0', ['gate:orch-recover-audit:step-1']] as [string, string[]]);
      mockGet.mockImplementationOnce(async () => pendingMeta);

      await recoverPendingGates();
      await flush();

      const insertCall = mockAuditInsert.mock.calls.find((c) => {
        const rec = c[0] as Record<string, unknown>;
        return rec.orchestrationId === 'orch-recover-audit' && rec.outcome === 'timeout';
      });
      expect(insertCall).toBeDefined();
      const rec = insertCall![0] as Record<string, unknown>;
      expect(rec.outcome).toBe('timeout');
      expect(rec.decidedBy).toBe('system');
      expect(rec.workspaceId).toBe('ws-recover');
      expect(rec.prompt).toBe('recover?');
    });
  });
});
