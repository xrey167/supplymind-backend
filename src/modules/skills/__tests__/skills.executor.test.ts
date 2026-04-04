import { describe, test, expect, beforeEach } from 'bun:test';
import { SkillExecutor } from '../skills.executor';

describe('SkillExecutor', () => {
  let executor: SkillExecutor;

  beforeEach(() => {
    executor = new SkillExecutor();
  });

  test('executes a function and returns result', async () => {
    const result = await executor.execute('test', async () => 42);
    expect(result).toBe(42);
  });

  test('tracks and decrements concurrency correctly', async () => {
    await executor.execute('test', async () => 'ok');
    // Should be able to run again (counters decremented)
    await executor.execute('test', async () => 'ok2');
  });

  test('throws on global concurrency limit', async () => {
    executor.maxGlobalConcurrency = 1;
    // Hold one slot open
    const hold = new Promise<void>((resolve) => setTimeout(resolve, 100));
    const p1 = executor.execute('a', () => hold);
    // Second should fail
    try {
      await executor.execute('b', async () => 'fail');
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.message).toContain('Global concurrency limit');
    }
    await p1;
  });

  test('throws on per-skill concurrency limit', async () => {
    executor.maxPerSkillConcurrency = 1;
    const hold = new Promise<void>((resolve) => setTimeout(resolve, 100));
    const p1 = executor.execute('same', () => hold);
    try {
      await executor.execute('same', async () => 'fail');
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('Per-skill concurrency limit');
    }
    await p1;
  });

  test('times out slow functions', async () => {
    executor.defaultTimeoutMs = 50;
    try {
      await executor.execute('slow', () => new Promise((r) => setTimeout(r, 500)));
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('timed out');
    }
  });

  test('per-skill timeout overrides default', async () => {
    executor.defaultTimeoutMs = 5000;
    executor.perSkillTimeouts.set('fast', 50);
    try {
      await executor.execute('fast', () => new Promise((r) => setTimeout(r, 500)));
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('timed out');
    }
  });

  test('decrements counters even on failure', async () => {
    try {
      await executor.execute('err', async () => { throw new Error('boom'); });
    } catch {}
    // Should work fine after — counters were cleaned up
    const result = await executor.execute('err', async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
