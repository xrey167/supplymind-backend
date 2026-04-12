import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { EventBus, type BusEvent } from '../../../../events/bus';
import { Topics } from '../../../../events/topics';

// --- mock db -----------------------------------------------------------------
const returningFn = mock(() => Promise.resolve([{ id: 'obs-1' }]));
const valuesFn = mock(() => ({ returning: returningFn }));
const insertFn = mock(() => ({ values: valuesFn }));

const fakeDb = { insert: insertFn };

mock.module('../../../../infra/db/client', () => ({ db: fakeDb }));
mock.module('../../../../infra/db/schema', () => ({
  learningObservations: Symbol('learningObservations'),
  skillPerformanceMetrics: { id: 'id', workspaceId: 'workspaceId', skillId: 'skillId', windowStart: 'windowStart' },
}));
mock.module('../../../../config/logger', () => ({
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));

const { initMemoryObserver, _resetMemoryObserver } = await import('../memory-observer');

// --- helpers -----------------------------------------------------------------
function captureHandler(bus: EventBus, topic: string) {
  const subscribeSpy = spyOn(bus, 'subscribe');
  initMemoryObserver(bus);
  const call = subscribeSpy.mock.calls.find((c) => c[0] === topic);
  if (!call) throw new Error(`No subscription found for ${topic}`);
  return call[1] as (event: BusEvent) => Promise<void>;
}

function makeEvent(topic: string, data: Record<string, unknown>): BusEvent {
  return {
    id: 'evt-1',
    topic,
    data,
    source: 'test',
    timestamp: new Date().toISOString(),
  };
}

// --- tests -------------------------------------------------------------------
describe('memory-observer', () => {
  beforeEach(() => {
    _resetMemoryObserver();
    insertFn.mockClear();
    valuesFn.mockClear();
    returningFn.mockClear();
  });

  it('subscribes to MEMORY_APPROVED and MEMORY_REJECTED', () => {
    const bus = new EventBus();
    const spy = spyOn(bus, 'subscribe');
    initMemoryObserver(bus);
    const topics = spy.mock.calls.map((c) => c[0]);
    expect(topics).toContain(Topics.MEMORY_APPROVED);
    expect(topics).toContain(Topics.MEMORY_REJECTED);
  });

  it('inserts observation with memory_approved on MEMORY_APPROVED', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.MEMORY_APPROVED);

    await handler(
      makeEvent(Topics.MEMORY_APPROVED, {
        workspaceId: 'ws-1',
        memoryId: 'mem-1',
        type: 'fact',
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.workspaceId).toBe('ws-1');
    expect(values.observationType).toBe('memory_approved');
    expect(values.signalStrength).toBe(0.7);
    expect(values.sourceTopic).toBe(Topics.MEMORY_APPROVED);
  });

  it('inserts observation with memory_rejected on MEMORY_REJECTED', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.MEMORY_REJECTED);

    await handler(
      makeEvent(Topics.MEMORY_REJECTED, {
        workspaceId: 'ws-1',
        memoryId: 'mem-2',
        type: 'fact',
        reason: 'inaccurate',
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.observationType).toBe('memory_rejected');
    expect(values.signalStrength).toBe(1.0);
    expect(values.sourceTopic).toBe(Topics.MEMORY_REJECTED);
  });

  it('skips insertion when workspaceId is missing (approved)', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.MEMORY_APPROVED);

    await handler(makeEvent(Topics.MEMORY_APPROVED, { memoryId: 'mem-1' }));

    expect(insertFn).not.toHaveBeenCalled();
  });

  it('skips insertion when workspaceId is missing (rejected)', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.MEMORY_REJECTED);

    await handler(makeEvent(Topics.MEMORY_REJECTED, { memoryId: 'mem-2' }));

    expect(insertFn).not.toHaveBeenCalled();
  });
});
