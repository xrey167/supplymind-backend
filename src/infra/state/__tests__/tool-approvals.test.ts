import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Mock logger before importing module under test
import { mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}) },
}));

const { createApprovalRequest, resolveApproval, pendingApprovalCount } = await import('../tool-approvals');

// ---- helpers ----

/** Drain the microtask queue so pending promise callbacks run. */
async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('tool-approvals', () => {
  // Each test must clean up any leftover state — easiest to resolve all created
  // approvals in afterEach so the module-level Map stays clean.

  describe('createApprovalRequest + resolveApproval', () => {
    it('happy path: resolves to true when approved', async () => {
      const promise = createApprovalRequest('ap-1', 'ws-1', 5000);

      const resolved = resolveApproval('ap-1', 'ws-1', true);

      expect(resolved).toBe(true);
      await expect(promise).resolves.toBe(true);
    });

    it('denial path: resolves to false when denied', async () => {
      const promise = createApprovalRequest('ap-2', 'ws-1', 5000);

      resolveApproval('ap-2', 'ws-1', false);

      await expect(promise).resolves.toBe(false);
    });

    it('timeout: promise resolves to false after timeoutMs', async () => {
      const promise = createApprovalRequest('ap-timeout', 'ws-1', 1);

      // Wait longer than the 1 ms timeout
      await new Promise<void>((r) => setTimeout(r, 10));

      await expect(promise).resolves.toBe(false);
    });

    it('cross-workspace rejection: resolveApproval returns false and does not resolve the promise', async () => {
      let resolved = false;
      const promise = createApprovalRequest('ap-cross', 'ws-correct', 5000);
      promise.then(() => { resolved = true; });

      const returnValue = resolveApproval('ap-cross', 'ws-wrong', true);

      await flush();

      expect(returnValue).toBe(false);
      expect(resolved).toBe(false);

      // Clean up — resolve with correct workspace so the timer doesn't leak
      resolveApproval('ap-cross', 'ws-correct', false);
      await promise;
    });

    it('cleanup: after resolving, a second resolve returns false', async () => {
      const promise = createApprovalRequest('ap-cleanup', 'ws-1', 5000);

      resolveApproval('ap-cleanup', 'ws-1', true);
      await promise;

      const second = resolveApproval('ap-cleanup', 'ws-1', true);
      expect(second).toBe(false);
    });

    it('cleanup: entry is removed after resolving (count decreases)', async () => {
      const before = pendingApprovalCount();
      const promise = createApprovalRequest('ap-count', 'ws-1', 5000);
      expect(pendingApprovalCount()).toBe(before + 1);

      resolveApproval('ap-count', 'ws-1', true);
      await promise;

      expect(pendingApprovalCount()).toBe(before);
    });
  });

  describe('resolveApproval for unknown id', () => {
    it('returns false when approvalId does not exist', () => {
      const result = resolveApproval('nonexistent-id', 'ws-1', true);
      expect(result).toBe(false);
    });
  });
});
