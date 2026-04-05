import { describe, it, expect } from 'bun:test';
import { summarizeToolUse, type ToolCallRecord } from '../tool-use-summary';

function makeCall(name: string, ok = true, durationMs = 100): ToolCallRecord {
  return { name, args: { input: 'test' }, result: { ok, value: ok ? 'done' : undefined, error: ok ? undefined : 'fail' }, durationMs, timestamp: Date.now() };
}

describe('summarizeToolUse', () => {
  it('returns all calls as recent when under threshold', () => {
    const calls = [makeCall('a'), makeCall('b')];
    const result = summarizeToolUse(calls, 5);
    expect(result.summary).toBe('');
    expect(result.recent).toHaveLength(2);
    expect(result.totalCalls).toBe(2);
  });

  it('summarizes older calls and keeps recent', () => {
    const calls = Array.from({ length: 8 }, (_, i) => makeCall(`tool-${i % 3}`));
    const result = summarizeToolUse(calls, 3);
    expect(result.recent).toHaveLength(3);
    expect(result.summary).toContain('5 earlier tool calls');
    expect(result.totalCalls).toBe(8);
  });

  it('groups by tool name in summary', () => {
    const calls = [makeCall('read'), makeCall('read'), makeCall('write'), makeCall('read'), makeCall('recent1'), makeCall('recent2')];
    const result = summarizeToolUse(calls, 2);
    expect(result.summary).toContain('read ×3');
    expect(result.summary).toContain('write ×1');
  });

  it('reports failures in summary', () => {
    const calls = [makeCall('fetch', false), makeCall('fetch', true), makeCall('r1'), makeCall('r2')];
    const result = summarizeToolUse(calls, 2);
    expect(result.summary).toContain('1ok/1err');
  });

  it('truncates long args', () => {
    const call: ToolCallRecord = { name: 'x', args: { data: 'a'.repeat(200) }, result: { ok: true }, durationMs: 10, timestamp: Date.now() };
    const result = summarizeToolUse([call, makeCall('r1'), makeCall('r2')], 2);
    expect(result.summary.length).toBeLessThan(300);
  });
});
