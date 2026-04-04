import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Minimal span mock
function makeSpanMock() {
  return {
    setStatus: mock(() => {}),
    recordException: mock(() => {}),
    end: mock(() => {}),
    setAttribute: mock(() => {}),
  };
}

// We need to mock @opentelemetry/api before importing otel.ts
// Bun supports module mocking via mock.module
const spanMock = makeSpanMock();

mock.module('@opentelemetry/api', () => {
  return {
    trace: {
      getTracer: () => ({
        startActiveSpan: async (_name: string, _opts: unknown, fn: (span: unknown) => Promise<unknown>) => {
          return fn(spanMock);
        },
      }),
    },
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
  };
});

// Import after mocking
const { withSpan, SpanStatusCode } = await import('../otel');

describe('withSpan', () => {
  beforeEach(() => {
    spanMock.setStatus.mockClear();
    spanMock.recordException.mockClear();
    spanMock.end.mockClear();
    spanMock.setAttribute.mockClear();
  });

  it('returns the result of fn on success', async () => {
    const result = await withSpan('test.op', { key: 'val' }, async (_span) => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('calls span.setStatus with OK on success', async () => {
    await withSpan('test.op', {}, async (_span) => 'ok');
    expect(spanMock.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('calls span.end after fn resolves', async () => {
    await withSpan('test.op', {}, async (_span) => 'done');
    expect(spanMock.end).toHaveBeenCalledTimes(1);
  });

  it('passes a span object to the callback', async () => {
    let capturedSpan: unknown;
    await withSpan('test.op', {}, async (span) => {
      capturedSpan = span;
      return null;
    });
    expect(capturedSpan).toBeDefined();
    expect(typeof (capturedSpan as any).setStatus).toBe('function');
  });

  it('span.setAttribute can be called inside fn', async () => {
    await withSpan('test.op', {}, async (span) => {
      span.setAttribute('custom.key', 'custom.value');
      return true;
    });
    expect(spanMock.setAttribute).toHaveBeenCalledWith('custom.key', 'custom.value');
  });

  it('re-throws errors from fn', async () => {
    const boom = new Error('boom');
    await expect(
      withSpan('test.op', {}, async (_span) => {
        throw boom;
      }),
    ).rejects.toThrow('boom');
  });

  it('sets ERROR status and records exception on failure', async () => {
    const err = new Error('fail');
    try {
      await withSpan('test.op', {}, async (_span) => {
        throw err;
      });
    } catch {}
    expect(spanMock.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'fail' });
    expect(spanMock.recordException).toHaveBeenCalledWith(err);
  });

  it('calls span.end even when fn throws', async () => {
    try {
      await withSpan('test.op', {}, async (_span) => {
        throw new Error('oops');
      });
    } catch {}
    expect(spanMock.end).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error throws', async () => {
    try {
      await withSpan('test.op', {}, async (_span) => {
        throw 'string error';
      });
    } catch {}
    expect(spanMock.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'string error' });
    expect(spanMock.recordException).toHaveBeenCalledWith(new Error('string error'));
  });
});
