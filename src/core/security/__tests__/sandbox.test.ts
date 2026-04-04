import { describe, test, expect } from 'bun:test';
import { runInSandbox } from '../sandbox';
import type { SandboxPolicy } from '../../../modules/settings/workspace-settings/workspace-settings.schemas';

const defaultPolicy: SandboxPolicy = {
  maxTimeoutMs: 5000,
  allowNetwork: false,
  allowedPaths: [],
  deniedPaths: [],
  maxMemoryMb: 128,
  lockedByOrg: false,
};

describe('runInSandbox', () => {
  test('should execute simple code and return result', async () => {
    const result = await runInSandbox({
      code: 'return args.a + args.b;',
      args: { a: 2, b: 3 },
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(5);
      expect(result.value.durationMs).toBeGreaterThan(0);
    }
  });

  test('should handle async code', async () => {
    const result = await runInSandbox({
      code: 'return await Promise.resolve(args.msg);',
      args: { msg: 'hello' },
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe('hello');
    }
  });

  test('should return error for code that throws', async () => {
    const result = await runInSandbox({
      code: 'throw new Error("boom");',
      args: {},
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('boom');
    }
  });

  test('should return null for code that returns undefined', async () => {
    const result = await runInSandbox({
      code: 'const x = 1;',
      args: {},
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBeNull();
    }
  });

  test('should timeout for long-running code', async () => {
    const result = await runInSandbox({
      code: 'await new Promise(r => setTimeout(r, 10000)); return 1;',
      args: {},
      policy: { ...defaultPolicy, maxTimeoutMs: 500 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('timeout');
    }
  }, 10000);

  test('should not have access to parent process env secrets', async () => {
    const result = await runInSandbox({
      code: 'return { db: process.env.DATABASE_URL ?? "none", sandbox: process.env.SANDBOX };',
      args: {},
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const val = result.value.value as { db: string; sandbox: string };
      expect(val.db).toBe('none');
      expect(val.sandbox).toBe('1');
    }
  });

  test('should handle code returning complex objects', async () => {
    const result = await runInSandbox({
      code: 'return { items: [1, 2, 3], nested: { ok: true } };',
      args: {},
      policy: defaultPolicy,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ items: [1, 2, 3], nested: { ok: true } });
    }
  });

  test('should handle syntax errors in code', async () => {
    const result = await runInSandbox({
      code: 'return {{{;',
      args: {},
      policy: defaultPolicy,
    });

    // Syntax error may surface as exit code error or runtime error
    expect(result.ok).toBe(false);
  });
});
