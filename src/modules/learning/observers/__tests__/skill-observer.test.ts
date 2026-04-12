import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { EventBus, type BusEvent } from '../../../../events/bus';
import { Topics } from '../../../../events/topics';

// --- mock db -----------------------------------------------------------------
const returningFn = mock(() => Promise.resolve([{ id: 'obs-1' }]));
const valuesFn = mock(() => ({ returning: returningFn }));
const insertFn = mock(() => ({ values: valuesFn }));

const setFn = mock(() => ({ where: mock(() => Promise.resolve()) }));
const updateFn = mock(() => ({ set: setFn }));

const limitFn = mock(() => Promise.resolve([]));
const whereFn = mock(() => ({ limit: limitFn }));
const fromFn = mock(() => ({ where: whereFn }));
const selectFn = mock(() => ({ from: fromFn }));

const fakeDb = {
  insert: insertFn,
  update: updateFn,
  select: selectFn,
};

mock.module('../../../../infra/db/client', () => ({ db: fakeDb }));
mock.module('../../../../infra/db/schema', () => ({
  learningObservations: Symbol('learningObservations'),
  skillPerformanceMetrics: { id: 'id', workspaceId: 'workspaceId', skillId: 'skillId', windowStart: 'windowStart' },
}));
mock.module('../../../../config/logger', () => ({
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));

// Import after mocks so the module picks up the fakes
const { initSkillObserver, _resetSkillObserver } = await import('../skill-observer');

// --- helpers -----------------------------------------------------------------
function captureHandler(bus: EventBus, topic: string) {
  const subscribeSpy = spyOn(bus, 'subscribe');
  initSkillObserver(bus);
  const call = subscribeSpy.mock.calls.find((c) => c[0] === topic);
  if (!call) throw new Error(`No subscription found for ${topic}`);
  return call[1] as (event: BusEvent) => Promise<void>;
}

function makeEvent(data: Record<string, unknown>): BusEvent {
  return {
    id: 'evt-1',
    topic: Topics.SKILL_INVOKED,
    data,
    source: 'test',
    timestamp: new Date().toISOString(),
  };
}

// --- tests -------------------------------------------------------------------
describe('skill-observer', () => {
  beforeEach(() => {
    _resetSkillObserver();
    insertFn.mockClear();
    valuesFn.mockClear();
    returningFn.mockClear();
    selectFn.mockClear();
    fromFn.mockClear();
    whereFn.mockClear();
    limitFn.mockClear();
    updateFn.mockClear();
    setFn.mockClear();
    // Default: no existing metrics row
    limitFn.mockResolvedValue([]);
  });

  it('subscribes to SKILL_INVOKED', () => {
    const bus = new EventBus();
    const spy = spyOn(bus, 'subscribe');
    initSkillObserver(bus);
    expect(spy).toHaveBeenCalledWith(Topics.SKILL_INVOKED, expect.any(Function));
  });

  it('inserts a learning observation on successful skill invocation', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.SKILL_INVOKED);

    await handler(
      makeEvent({
        name: 'summarize',
        workspaceId: 'ws-1',
        pluginId: 'plug-1',
        durationMs: 120,
        success: true,
      }),
    );

    expect(insertFn).toHaveBeenCalled();
    const insertedValues = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedValues.workspaceId).toBe('ws-1');
    expect(insertedValues.observationType).toBe('skill_success');
  });

  it('records skill_failure observation when success is false', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.SKILL_INVOKED);

    await handler(
      makeEvent({
        name: 'summarize',
        workspaceId: 'ws-1',
        success: false,
        error: 'timeout',
      }),
    );

    const insertedValues = valuesFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedValues.observationType).toBe('skill_failure');
    expect(insertedValues.signalStrength).toBe(1.0);
  });

  it('skips when workspaceId is missing', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.SKILL_INVOKED);

    await handler(makeEvent({ name: 'summarize' }));

    expect(insertFn).not.toHaveBeenCalled();
  });

  it('inserts new performance metrics when none exist', async () => {
    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.SKILL_INVOKED);

    await handler(
      makeEvent({
        name: 'summarize',
        workspaceId: 'ws-1',
        pluginId: 'plug-1',
        durationMs: 200,
        success: true,
      }),
    );

    // First insert: observation, second insert: new metrics row
    expect(insertFn).toHaveBeenCalledTimes(2);
  });

  it('updates existing performance metrics when a row already exists', async () => {
    limitFn.mockResolvedValue([
      {
        id: 'met-1',
        workspaceId: 'ws-1',
        skillId: 'summarize',
        invocationCount: 5,
        successCount: 4,
        failureCount: 1,
        avgLatencyMs: 100,
        lastFailureReason: null,
      },
    ]);

    const bus = new EventBus();
    const handler = captureHandler(bus, Topics.SKILL_INVOKED);

    await handler(
      makeEvent({
        name: 'summarize',
        workspaceId: 'ws-1',
        durationMs: 150,
        success: true,
      }),
    );

    // Only one insert (the observation), the metrics row is updated
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(updateFn).toHaveBeenCalled();
  });
});
