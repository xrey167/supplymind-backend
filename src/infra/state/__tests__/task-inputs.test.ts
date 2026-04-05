import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { createInputRequest, resolveInput, pendingInputCount } = await import('../task-inputs');

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('task-inputs', () => {
  describe('createInputRequest + resolveInput', () => {
    it('happy path: resolves with user input', async () => {
      const promise = createInputRequest('t-1', 'ws-1', 'What is your name?', 5000);

      const resolved = resolveInput('t-1', 'ws-1', { name: 'Alice' });

      expect(resolved).toBe(true);
      await expect(promise).resolves.toEqual({ name: 'Alice' });
    });

    it('resolves with string input', async () => {
      const promise = createInputRequest('t-2', 'ws-1', 'Confirm?', 5000);

      resolveInput('t-2', 'ws-1', 'yes');

      await expect(promise).resolves.toBe('yes');
    });

    it('timeout: resolves to null after timeoutMs', async () => {
      const promise = createInputRequest('t-timeout', 'ws-1', 'Question?', 1);

      await new Promise<void>((r) => setTimeout(r, 10));

      await expect(promise).resolves.toBe(null);
    });

    it('cross-workspace rejection: returns false and does not resolve', async () => {
      let resolved = false;
      const promise = createInputRequest('t-cross', 'ws-correct', 'Q?', 5000);
      promise.then(() => { resolved = true; });

      const returnValue = resolveInput('t-cross', 'ws-wrong', 'answer');

      await flush();

      expect(returnValue).toBe(false);
      expect(resolved).toBe(false);

      // Clean up
      resolveInput('t-cross', 'ws-correct', null);
      await promise;
    });

    it('cleanup: after resolving, a second resolve returns false', async () => {
      const promise = createInputRequest('t-cleanup', 'ws-1', 'Q?', 5000);

      resolveInput('t-cleanup', 'ws-1', 'answer');
      await promise;

      expect(resolveInput('t-cleanup', 'ws-1', 'again')).toBe(false);
    });

    it('count tracks pending requests', async () => {
      const before = pendingInputCount();
      const promise = createInputRequest('t-count', 'ws-1', 'Q?', 5000);
      expect(pendingInputCount()).toBe(before + 1);

      resolveInput('t-count', 'ws-1', 'done');
      await promise;

      expect(pendingInputCount()).toBe(before);
    });
  });

  describe('resolveInput for unknown id', () => {
    it('returns false when taskId does not exist', () => {
      expect(resolveInput('nonexistent', 'ws-1', 'data')).toBe(false);
    });
  });
});
