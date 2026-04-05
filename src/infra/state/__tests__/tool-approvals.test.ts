import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Mock logger before importing module under test
import { mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { createApprovalRequest, resolveApproval, cancelApproval, pendingApprovalCount } = await import('../tool-approvals');

// ---- helpers ----

/** Drain the microtask queue so pending promise callbacks run. */
async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('tool-approvals', () => {
  // Each test must clean up any leftover state — easiest to resolve all created
  // approvals in afterEach so the module-level Map stays clean.

  describe('createApprovalRequest + resolveApproval', () => {
    it('happy path: resolves to approved when approved', async () => {
      const promise = createApprovalRequest('ap-1', 'ws-1', 5000);

      const resolved = resolveApproval('ap-1', 'ws-1', true);

      expect(resolved).toBe(true);
      const result = await promise;
      expect(result.approved).toBe(true);
    });

    it('denial path: resolves to not approved when denied', async () => {
      const promise = createApprovalRequest('ap-2', 'ws-1', 5000);

      resolveApproval('ap-2', 'ws-1', false);

      const result = await promise;
      expect(result.approved).toBe(false);
    });

    it('timeout: promise resolves to not approved after timeoutMs', async () => {
      const promise = createApprovalRequest('ap-timeout', 'ws-1', 1);

      // Wait longer than the 1 ms timeout
      await new Promise<void>((r) => setTimeout(r, 10));

      const result = await promise;
      expect(result.approved).toBe(false);
    });

    it('updatedInput: carries modified args when approved with input', async () => {
      const promise = createApprovalRequest('ap-input', 'ws-1', 5000);

      resolveApproval('ap-input', 'ws-1', true, { file: '/safe/path.txt' });

      const result = await promise;
      expect(result.approved).toBe(true);
      expect(result.updatedInput).toEqual({ file: '/safe/path.txt' });
    });

    it('updatedInput: not included when denied', async () => {
      const promise = createApprovalRequest('ap-deny-input', 'ws-1', 5000);

      resolveApproval('ap-deny-input', 'ws-1', false, { file: 'ignored' });

      const result = await promise;
      expect(result.approved).toBe(false);
      expect(result.updatedInput).toBeUndefined();
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

  describe('cancelApproval', () => {
    it('cancels a pending approval (resolves as denied)', async () => {
      const promise = createApprovalRequest('ap-cancel', 'ws-1', 5000);

      const canceled = cancelApproval('ap-cancel', 'ws-1');

      expect(canceled).toBe(true);
      const result = await promise;
      expect(result.approved).toBe(false);
    });

    it('returns false for unknown approval', () => {
      expect(cancelApproval('nonexistent', 'ws-1')).toBe(false);
    });
  });

  describe('resolveApproval for unknown id', () => {
    it('returns false when approvalId does not exist', () => {
      const result = resolveApproval('nonexistent-id', 'ws-1', true);
      expect(result).toBe(false);
    });
  });
});
