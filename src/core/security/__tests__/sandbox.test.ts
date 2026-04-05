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

  test('should block fetch when allowNetwork is false', async () => {
    const result = await runInSandbox({
      code: 'try { await fetch("http://example.com"); return "fetched"; } catch (e) { return e.message; }',
      args: {},
      policy: { ...defaultPolicy, allowNetwork: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toContain('Network access is disabled');
    }
  });

  test('should block Bun.write outside allowedPaths', async () => {
    const tmpDir = require('os').tmpdir().replace(/\\/g, '/');
    const result = await runInSandbox({
      code: `try { await Bun.write("${tmpDir}/sandbox-test-blocked.txt", "data"); return "written"; } catch (e) { return e.message; }`,
      args: {},
      policy: { ...defaultPolicy, allowedPaths: ['/nonexistent-dir'], deniedPaths: [] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toContain('not in sandbox allowlist');
    }
  });

  test('should block Bun.write to deniedPaths', async () => {
    const tmpDir = require('os').tmpdir().replace(/\\/g, '/');
    const result = await runInSandbox({
      code: `try { await Bun.write("${tmpDir}/sandbox-test-denied.txt", "data"); return "written"; } catch (e) { return e.message; }`,
      args: {},
      policy: { ...defaultPolicy, allowedPaths: [], deniedPaths: [tmpDir] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toContain('blocked by sandbox policy');
    }
  });

  test('should allow fetch when allowNetwork is true', async () => {
    // Just verify fetch isn't blocked — the actual fetch may fail due to DNS, but shouldn't throw sandbox error
    const result = await runInSandbox({
      code: 'try { await fetch("http://0.0.0.0:1"); return "attempted"; } catch (e) { return e.message; }',
      args: {},
      policy: { ...defaultPolicy, allowNetwork: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should NOT contain the sandbox policy message
      expect(String(result.value.value)).not.toContain('Network access is disabled');
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
