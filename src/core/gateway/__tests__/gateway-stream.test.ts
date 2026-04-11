import { describe, it, expect, mock } from 'bun:test';
import { EventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import type { GatewayEvent } from '../gateway.types';
import { bridgeTaskEvents } from '../gateway-stream';

/**
 * Gateway stream tests use a fresh EventBus instance injected via the optional
 * `bus` parameter — this avoids contamination from other test files that mock
 * the events/bus module singleton.
 */

describe('bridgeTaskEvents', () => {
  it('forwards matching text_delta events as GatewayEvents', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-1', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-1', delta: 'Hello' });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text_delta');
    expect((events[0].data as any).delta).toBe('Hello');

    cleanup();
  });

  it('ignores events for other tasks', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-2', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'other-task', delta: 'Nope' });

    expect(events).toHaveLength(0);

    cleanup();
  });

  it('forwards status events', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-3', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_STATUS, { taskId: 'stream-test-3', status: 'working' });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('status');

    cleanup();
  });

  it('forwards tool_call events', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-4', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_TOOL_CALL, { taskId: 'stream-test-4', toolName: 'echo', args: {} });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');

    cleanup();
  });

  it('auto-unsubscribes on task completion (done event)', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    bridgeTaskEvents('stream-test-5', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_COMPLETED, { taskId: 'stream-test-5', output: 'done' });

    expect(events.some((e) => e.type === 'done')).toBe(true);

    const countBefore = events.length;
    await bus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-5', delta: 'late' });
    expect(events.length).toBe(countBefore);
  });

  it('auto-unsubscribes on task error', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    bridgeTaskEvents('stream-test-6', (e) => events.push(e), bus);

    await bus.publish(Topics.TASK_ERROR, { taskId: 'stream-test-6', error: 'boom' });

    expect(events.some((e) => e.type === 'error')).toBe(true);

    const countBefore = events.length;
    await bus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-6', delta: 'late' });
    expect(events.length).toBe(countBefore);
  });

  it('manual cleanup stops all event forwarding', async () => {
    const bus = new EventBus();
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-7', (e) => events.push(e), bus);

    cleanup();

    await bus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-7', delta: 'after cleanup' });
    expect(events).toHaveLength(0);
  });

  it('cleanup is idempotent', () => {
    const bus = new EventBus();
    const onEvent = mock((_e: GatewayEvent) => {});
    const cleanup = bridgeTaskEvents('stream-test-8', onEvent, bus);
    cleanup();
    cleanup(); // should not throw
  });
});
