import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { createGateRequest, resolveGate, pendingGateCount, gateKey } = await import('../orchestration-gates');

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('orchestration-gates', () => {
  describe('gateKey', () => {
    it('builds composite key', () => {
      expect(gateKey('orch-1', 'step-1')).toBe('orch-1:step-1');
    });
  });

  describe('createGateRequest + resolveGate', () => {
    it('happy path: resolves to true when approved', async () => {
      const promise = createGateRequest('orch-1', 'step-1', 'ws-1', 5000);

      const resolved = resolveGate('orch-1', 'step-1', 'ws-1', true);

      expect(resolved).toBe(true);
      await expect(promise).resolves.toBe(true);
    });

    it('denial path: resolves to false when denied', async () => {
      const promise = createGateRequest('orch-2', 'step-1', 'ws-1', 5000);

      resolveGate('orch-2', 'step-1', 'ws-1', false);

      await expect(promise).resolves.toBe(false);
    });

    it('timeout: resolves to false after timeoutMs', async () => {
      const promise = createGateRequest('orch-timeout', 'step-1', 'ws-1', 1);

      await new Promise<void>((r) => setTimeout(r, 10));

      await expect(promise).resolves.toBe(false);
    });

    it('cross-workspace rejection', async () => {
      let resolved = false;
      const promise = createGateRequest('orch-cross', 'step-1', 'ws-correct', 5000);
      promise.then(() => { resolved = true; });

      const returnValue = resolveGate('orch-cross', 'step-1', 'ws-wrong', true);

      await flush();

      expect(returnValue).toBe(false);
      expect(resolved).toBe(false);

      // Clean up
      resolveGate('orch-cross', 'step-1', 'ws-correct', false);
      await promise;
    });

    it('cleanup: after resolving, a second resolve returns false', async () => {
      const promise = createGateRequest('orch-cleanup', 'step-1', 'ws-1', 5000);

      resolveGate('orch-cleanup', 'step-1', 'ws-1', true);
      await promise;

      expect(resolveGate('orch-cleanup', 'step-1', 'ws-1', true)).toBe(false);
    });

    it('count tracks pending gates', async () => {
      const before = pendingGateCount();
      const promise = createGateRequest('orch-count', 'step-1', 'ws-1', 5000);
      expect(pendingGateCount()).toBe(before + 1);

      resolveGate('orch-count', 'step-1', 'ws-1', true);
      await promise;

      expect(pendingGateCount()).toBe(before);
    });
  });

  describe('resolveGate for unknown gate', () => {
    it('returns false when gate does not exist', () => {
      expect(resolveGate('nonexistent', 'step-x', 'ws-1', true)).toBe(false);
    });
  });
});
