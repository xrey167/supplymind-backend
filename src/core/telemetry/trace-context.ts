import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/** Branded trace ID — prevents accidental mixing with other string IDs */
export type TraceId = string & { readonly __brand: 'TraceId' };

const traceStorage = new AsyncLocalStorage<TraceId>();

export function generateTraceId(): TraceId {
  return randomUUID() as TraceId;
}

export function withTraceId<T>(id: TraceId, fn: () => T): T {
  return traceStorage.run(id, fn);
}

export function getCurrentTraceId(): TraceId | undefined {
  return traceStorage.getStore();
}

export function requireTraceId(): TraceId {
  const id = traceStorage.getStore();
  if (!id) throw new Error('No trace context — wrap call in withTraceId()');
  return id;
}
