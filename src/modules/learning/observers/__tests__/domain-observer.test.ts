import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
// Minimal EventBus stub — avoids importing the real bus module which
// breaks under cross-file mock.module contamination in bun:test.
interface BusEvent {
  id: string;
  topic: string;
  data: unknown;
  source: string;
  timestamp: string;
}

class EventBus {
  subscribe(
    _pattern: string,
    _handler: (event: BusEvent) => void | Promise<void>,
  ): string {
    return 'sub-stub';
  }
}
import { Topics } from '../../../../events/topics';

// --- mock db -----------------------------------------------------------------
const returningFn = mock(() => Promise.resolve([{ id: 'obs-1' }]));
const valuesFn = mock(() => ({ returning: returningFn }));
const insertFn = mock(() => ({ values: valuesFn }));

const fakeDb = { insert: insertFn };

mock.module('../../../../infra/db/client', () => ({ db: {} }));
mock.module('../../../../infra/db/schema', () => ({
  learningObservations: Symbol('learningObservations'),
  skillPerformanceMetrics: { id: 'id', workspaceId: 'workspaceId', skillId: 'skillId', windowStart: 'windowStart' },
}));
mock.module('../../../../config/logger', () => ({
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));

const { initDomainObserver, _resetDomainObserver } = await import('../domain-observer');

// --- helpers -----------------------------------------------------------------
function captureHandler(bus: EventBus, topic: string) {
  const subscribeSpy = spyOn(bus, 'subscribe');
  initDomainObserver(bus, fakeDb as any);
  const call = subscribeSpy.mock.calls.find((c) => c[0] === topic);
  if (!call) throw new Error(`No subscription found for ${topic}`);
  return call[1] as (event: BusEvent) => Promise<void>;
}

function makeEvent(data: Record<string, unknown>): BusEvent {
  return {
    id: 'evt-1',
    topic: Topics.DOMAIN_KNOWLEDGE_UPDATED,
    data,
    source: 'test',
    timestamp: new Date().toISOString(),
  };
}

// --- tests -------------------------------------------------------------------
describe('domain-observer', () => {
  beforeEach(() => {
    _resetDomainObserver();
    insertFn.mockClear();
    valuesFn.mockClear();
    returningFn.mockClear();
  });

  it('subscribes to DOMAIN_KNOWLEDGE_UPDATED', () => {
    const bus = new EventBus();
    const spy = spyOn(bus, 'subscribe');
    initDomainObserver(bus, fakeDb as any);
    expect(spy).toHaveBeenCalledWith(Topics.DOMAIN_KNOWLEDGE_UPDATED, expect.any(Function));
  });

  it('inserts domain_knowledge_update observation', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.DOMAIN_KNOWLEDGE_UPDATED);

    await handler(
      makeEvent({
        pluginId: 'plug-1',
        workspaceId: 'ws-1',
        changesCount: 5,
        confidence: 0.9,
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.workspaceId).toBe('ws-1');
    expect(values.pluginId).toBe('plug-1');
    expect(values.observationType).toBe('domain_knowledge_update');
    expect(values.signalStrength).toBe(0.9);
    expect(values.sourceTopic).toBe(Topics.DOMAIN_KNOWLEDGE_UPDATED);
  });

  it('uses default signalStrength 0.5 when confidence is not provided', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.DOMAIN_KNOWLEDGE_UPDATED);

    await handler(
      makeEvent({
        pluginId: 'plug-1',
        workspaceId: 'ws-1',
      }),
    );

    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.signalStrength).toBe(0.5);
  });

  it('skips when workspaceId is missing', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.DOMAIN_KNOWLEDGE_UPDATED);

    await handler(makeEvent({ pluginId: 'plug-1', changesCount: 3 }));

    expect(insertFn).not.toHaveBeenCalled();
  });
});
