import type { Context } from 'hono';
import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';

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

/** SSE endpoint that streams events for a specific task */
export function taskEventStream(c: Context, taskId: string): Response {
  return sseResponse(c, (send, close) => {
    const topics = ['task:status', 'task:text_delta', 'task:tool_call', 'task:artifact', 'task:error', 'task:completed'];
    const subIds: string[] = [];
    for (const topic of topics) {
      const id = eventBus.subscribe(topic, (event) => {
        const data = event.data as any;
        if (data.taskId === taskId) {
          send(topic, data);
          if (topic === 'task:completed' || topic === 'task:error') {
            close();
          }
        }
      });
      subIds.push(id);
    }
    return () => subIds.forEach(id => eventBus.unsubscribe(id));
  });
}
