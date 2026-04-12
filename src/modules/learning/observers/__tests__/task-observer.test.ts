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

const { initTaskObserver, _resetTaskObserver } = await import('../task-observer');

// --- helpers -----------------------------------------------------------------
function captureHandler(bus: EventBus, topic: string) {
  const subscribeSpy = spyOn(bus, 'subscribe');
  initTaskObserver(bus);
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
describe('task-observer', () => {
  beforeEach(() => {
    _resetTaskObserver();
    insertFn.mockClear();
    valuesFn.mockClear();
    returningFn.mockClear();
  });

  it('subscribes to TASK_COMPLETED and TASK_ERROR', () => {
    const bus = new EventBus();
    const spy = spyOn(bus, 'subscribe');
    initTaskObserver(bus);
    const topics = spy.mock.calls.map((c) => c[0]);
    expect(topics).toContain(Topics.TASK_COMPLETED);
    expect(topics).toContain(Topics.TASK_ERROR);
  });

  it('inserts task_completed observation on TASK_COMPLETED', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.TASK_COMPLETED);

    await handler(
      makeEvent(Topics.TASK_COMPLETED, {
        taskId: 'task-1',
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        durationMs: 500,
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.workspaceId).toBe('ws-1');
    expect(values.observationType).toBe('task_completed');
    expect(values.signalStrength).toBe(0.5);
    expect(values.sourceTopic).toBe(Topics.TASK_COMPLETED);
  });

  it('inserts task_error observation on TASK_ERROR', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.TASK_ERROR);

    await handler(
      makeEvent(Topics.TASK_ERROR, {
        taskId: 'task-2',
        workspaceId: 'ws-1',
        error: 'out of memory',
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const values = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.observationType).toBe('task_error');
    expect(values.signalStrength).toBe(1.0);
    expect(values.sourceTopic).toBe(Topics.TASK_ERROR);
  });

  it('skips insertion when workspaceId is missing (completed)', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.TASK_COMPLETED);

    await handler(makeEvent(Topics.TASK_COMPLETED, { taskId: 'task-1' }));

    expect(insertFn).not.toHaveBeenCalled();
  });

  it('skips insertion when workspaceId is missing (error)', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.TASK_ERROR);

    await handler(makeEvent(Topics.TASK_ERROR, { taskId: 'task-2' }));

    expect(insertFn).not.toHaveBeenCalled();
  });
});
