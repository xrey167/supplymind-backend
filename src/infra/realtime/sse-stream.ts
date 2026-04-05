import type { Context } from 'hono';
import { logger } from '../../config/logger';
import { bridgeTaskEvents } from '../../core/gateway';
import type { GatewayEvent } from '../../core/gateway';

export function sseResponse(
  c: Context,
  setup: (send: (event: string, data: unknown) => void, close: () => void) => void | (() => void),
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (err) { logger.warn({ event, error: err instanceof Error ? err.message : String(err) }, 'SSE send failed, stream likely closed'); }
      };
      const close = () => {
        try { controller.close(); } catch { /* already closed */ }
      };
      // Heartbeat
      const hb = setInterval(() => send('heartbeat', {}), 30_000);
      const cleanup = setup(send, close);
      // Signal cleanup on abort
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(hb);
        if (typeof cleanup === 'function') cleanup();
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/** SSE endpoint that streams events for a specific task via the gateway stream bridge */
export function taskEventStream(c: Context, taskId: string): Response {
  return sseResponse(c, (send, close) => {
    const cleanup = bridgeTaskEvents(taskId, (event: GatewayEvent) => {
      const data = event.data as Record<string, unknown>;
      send(`task:${event.type}`, data);

      if (event.type === 'done' || event.type === 'error') {
        close();
      }
    });

    return cleanup;
  });
}
