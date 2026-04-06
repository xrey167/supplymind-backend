import { describe, it, expect } from 'bun:test';
import { withTraceId, getCurrentTraceId, requireTraceId, generateTraceId, type TraceId } from '../trace-context';

describe('trace-context', () => {
  it('propagates traceId through async calls', async () => {
    const id = generateTraceId();
    let captured: TraceId | undefined;
    await withTraceId(id, async () => {
      captured = getCurrentTraceId();
    });
    expect(captured).toBe(id);
  });

  it('returns undefined outside of trace context', () => {
    expect(getCurrentTraceId()).toBeUndefined();
  });

  it('requireTraceId throws when no context', () => {
    expect(() => requireTraceId()).toThrow('No trace context');
  });

  it('requireTraceId returns id when set', async () => {
    const id = generateTraceId();
    let result: TraceId | undefined;
    await withTraceId(id, async () => {
      result = requireTraceId();
    });
    expect(result).toBe(id);
  });

  it('generateTraceId creates unique IDs', () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
  });

  it('nested withTraceId overrides parent', async () => {
    const outer = generateTraceId();
    const inner = generateTraceId();
    let innerId: TraceId | undefined;
    let outerAfter: TraceId | undefined;
    await withTraceId(outer, async () => {
      await withTraceId(inner, async () => {
        innerId = getCurrentTraceId();
      });
      outerAfter = getCurrentTraceId();
    });
    expect(innerId).toBe(inner);
    expect(outerAfter).toBe(outer);
  });

  it('traceId can be included in event payloads', async () => {
    const id = generateTraceId();
    let eventTraceId: string | undefined;
    await withTraceId(id, async () => {
      // Simulate building an event payload with the current traceId
      const payload = { type: 'task.created', traceId: getCurrentTraceId() };
      eventTraceId = payload.traceId;
    });
    expect(eventTraceId).toBe(id);
  });
});
