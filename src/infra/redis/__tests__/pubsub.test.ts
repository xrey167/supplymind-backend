import { describe, test, expect, beforeEach } from 'bun:test';
import { RedisPubSub } from '../pubsub';
import { EventBus } from '../../../events/bus';

describe('RedisPubSub', () => {
  let bus: EventBus;
  let published: Array<{ channel: string; message: string }>;
  let mockRedisPublisher: any;

  beforeEach(() => {
    bus = new EventBus();
    published = [];
    mockRedisPublisher = {
      publish: (channel: string, message: string) => {
        published.push({ channel, message });
        return Promise.resolve(1);
      },
    };
  });

  test('forwards bus events to Redis', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.*');

    await bus.publish('task.completed', { taskId: '123' });
    expect(published).toHaveLength(1);
    expect(published[0].channel).toBe('task.completed');
    const parsed = JSON.parse(published[0].message);
    expect(parsed.data.taskId).toBe('123');
  });

  test('does not forward non-matching topics', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.*');

    await bus.publish('agent.created', {});
    expect(published).toHaveLength(0);
  });

  test('multiple bridge patterns work independently', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.#');
    pubsub.bridgeToRedis('agent.*');

    await bus.publish('task.status.changed', {});
    await bus.publish('agent.created', {});
    await bus.publish('workflow.started', {});
    expect(published).toHaveLength(2);
  });
});
