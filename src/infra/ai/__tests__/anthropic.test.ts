import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { StreamEvent } from '../types';

/**
 * Helper: collect all events from an async iterable with an optional timeout guard
 * so the test itself doesn't hang forever if something goes wrong.
 */
async function collect(
  iter: AsyncIterable<StreamEvent>,
  timeoutMs = 2000,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('collect() timed out')), timeoutMs),
  );

  await Promise.race([
    (async () => {
      for await (const ev of iter) {
        events.push(ev);
      }
    })(),
    deadline,
  ]);

  return events;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake Anthropic-style async iterable that either:
 *   - blocks until signal aborts (stalled), or
 *   - yields `count` text_delta events at `intervalMs` intervals then message_stop
 */
function makeAnthropicStream(
  opts: { stalled: true; signal?: AbortSignal } | { count: number; intervalMs: number },
) {
  if ('stalled' in opts) {
    const { signal } = opts;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<never>> {
            return new Promise<never>((_, reject) => {
              if (signal?.aborted) {
                reject(signal.reason ?? new Error('aborted'));
                return;
              }
              if (signal) {
                signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
                  once: true,
                });
              }
              // otherwise blocks forever (no-signal path shouldn't be used in tests)
            });
          },
        };
      },
    };
  }

  const { count, intervalMs } = opts;
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `chunk${i}` },
        };
      }
      await new Promise((r) => setTimeout(r, intervalMs));
      yield { type: 'message_stop' };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicRawRuntime stream() watchdog', () => {
  const originalEnv = process.env.STREAM_WATCHDOG_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STREAM_WATCHDOG_MS;
    } else {
      process.env.STREAM_WATCHDOG_MS = originalEnv;
    }
  });

  it('fires and yields an error event when the stream stalls', async () => {
    process.env.STREAM_WATCHDOG_MS = '100';

    // Dynamically import so the env var is already set when the module reads it
    // (modules are cached, so we monkey-patch the client instead)
    const { AnthropicRawRuntime } = await import('../anthropic');
    const runtime = new AnthropicRawRuntime('test-key');

    // Replace the internal client with one whose messages.stream returns a stalled iterable.
    // Capture the signal passed by the runtime so the mock can unblock when aborted.
    (runtime as any).client = {
      messages: {
        stream: (_params: unknown, opts: { signal?: AbortSignal }) =>
          makeAnthropicStream({ stalled: true, signal: opts?.signal }),
      },
    };

    const input = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };

    const start = Date.now();
    const events = await collect(runtime.stream(input), 1000);
    const elapsed = Date.now() - start;

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBe(1);
    expect((errorEvents[0].data as any).error).toContain('watchdog');
    // Should have fired within ~500ms (watchdog is 100ms + some slack)
    expect(elapsed).toBeLessThan(600);
  });

  it('does NOT fire when chunks arrive regularly within the window', async () => {
    process.env.STREAM_WATCHDOG_MS = '200';

    const { AnthropicRawRuntime } = await import('../anthropic');
    const runtime = new AnthropicRawRuntime('test-key');

    // 5 chunks, 50ms apart — well within 200ms watchdog
    (runtime as any).client = {
      messages: {
        stream: (_params: unknown, _opts: unknown) =>
          makeAnthropicStream({ count: 5, intervalMs: 50 }),
      },
    };

    const input = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };

    const events = await collect(runtime.stream(input), 2000);

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBe(0);

    const textEvents = events.filter((e) => e.type === 'text_delta');
    expect(textEvents.length).toBe(5);

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents.length).toBe(1);
  });
});
