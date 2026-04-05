import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { GatewayEvent } from '../gateway.types';
import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';

/**
 * Gateway stream tests use the REAL eventBus — no mock.module needed.
 * We publish events directly and verify the bridge forwards them correctly.
 * This avoids polluting the eventBus mock for other test files.
 */

const { bridgeTaskEvents } = await import('../gateway-stream');

// ---- Tests ----

describe('bridgeTaskEvents', () => {
  it('forwards matching text_delta events as GatewayEvents', async () => {
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-1', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-1', delta: 'Hello' });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text_delta');
    expect((events[0].data as any).delta).toBe('Hello');

    cleanup();
  });

  it('ignores events for other tasks', async () => {
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-2', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'other-task', delta: 'Nope' });

    expect(events).toHaveLength(0);

    cleanup();
  });

  it('forwards status events', async () => {
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-3', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_STATUS, { taskId: 'stream-test-3', status: 'working' });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('status');

    cleanup();
  });

  it('forwards tool_call events', async () => {
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-4', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_TOOL_CALL, { taskId: 'stream-test-4', toolName: 'echo', args: {} });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');

    cleanup();
  });

  it('auto-unsubscribes on task completion (done event)', async () => {
    const events: GatewayEvent[] = [];
    bridgeTaskEvents('stream-test-5', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_COMPLETED, { taskId: 'stream-test-5', output: 'done' });

    // Should have received the done event
    expect(events.some((e) => e.type === 'done')).toBe(true);

    // After cleanup, further events should NOT arrive
    const countBefore = events.length;
    await eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-5', delta: 'late' });
    expect(events.length).toBe(countBefore);
  });

  it('auto-unsubscribes on task error', async () => {
    const events: GatewayEvent[] = [];
    bridgeTaskEvents('stream-test-6', (e) => events.push(e));

    await eventBus.publish(Topics.TASK_ERROR, { taskId: 'stream-test-6', error: 'boom' });

    expect(events.some((e) => e.type === 'error')).toBe(true);

    // After auto-cleanup, no more events
    const countBefore = events.length;
    await eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-6', delta: 'late' });
    expect(events.length).toBe(countBefore);
  });

  it('manual cleanup stops all event forwarding', async () => {
    const events: GatewayEvent[] = [];
    const cleanup = bridgeTaskEvents('stream-test-7', (e) => events.push(e));

    cleanup();

    await eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId: 'stream-test-7', delta: 'after cleanup' });
    expect(events).toHaveLength(0);
  });

  it('cleanup is idempotent', () => {
    const onEvent = mock((_e: GatewayEvent) => {});
    const cleanup = bridgeTaskEvents('stream-test-8', onEvent);
    cleanup();
    cleanup(); // should not throw
  });
});
