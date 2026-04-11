import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import Redis from 'ioredis';
import { RedisCache } from '../../src/infra/cache/redis-cache';
import { RedisPubSub } from '../../src/infra/redis/pubsub';
import { EventBus } from '../../src/events/bus';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('Redis integration', () => {
  let client: Redis;

  beforeAll(() => {
    client = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    await client.flushdb();
    await client.quit();
  });

  it('ping returns PONG', async () => {
    const result = await client.ping();
    expect(result).toBe('PONG');
  });

  describe('RedisCache', () => {
    let cache: RedisCache;

    beforeAll(() => {
      cache = new RedisCache(client);
    });

    it('set and get a value', async () => {
      await cache.set('test:key1', { name: 'Alice' });
      const result = await cache.get<{ name: string }>('test:key1');
      expect(result).toEqual({ name: 'Alice' });
    });

    it('get returns undefined for missing key', async () => {
      const result = await cache.get('test:nonexistent');
      expect(result).toBeUndefined();
    });

    it('set with TTL expires the key', async () => {
      await cache.set('test:ttl', 'ephemeral', 100);
      const before = await cache.get('test:ttl');
      expect(before).toBe('ephemeral');

      await new Promise((r) => setTimeout(r, 150));
      const after = await cache.get('test:ttl');
      expect(after).toBeUndefined();
    });

    it('del removes a key and returns true', async () => {
      await cache.set('test:del', 'bye');
      const deleted = await cache.del('test:del');
      expect(deleted).toBe(true);

      const after = await cache.get('test:del');
      expect(after).toBeUndefined();
    });

    it('del returns false for missing key', async () => {
      const deleted = await cache.del('test:nope');
      expect(deleted).toBe(false);
    });

    it('clear removes keys matching pattern', async () => {
      await cache.set('test:clear:a', 1);
      await cache.set('test:clear:b', 2);
      await cache.clear('test:clear:*');

      expect(await cache.get('test:clear:a')).toBeUndefined();
      expect(await cache.get('test:clear:b')).toBeUndefined();
    });
  });

  describe('RedisPubSub', () => {
    let bus: EventBus;
    let publisher: Redis;
    let subscriber: Redis;
    let pubsub: RedisPubSub;

    beforeAll(() => {
      bus = new EventBus();
      publisher = new Redis(REDIS_URL);
      subscriber = new Redis(REDIS_URL);
      pubsub = new RedisPubSub(bus, publisher, subscriber);
    });

    afterAll(async () => {
      await pubsub.destroy();
    });

    it('bridgeToRedis publishes bus events to Redis', async () => {
      const received: string[] = [];
      const listener = new Redis(REDIS_URL);
      await listener.subscribe('test.outbound');
      listener.on('message', (_ch, msg) => received.push(msg));

      pubsub.bridgeToRedis('test.outbound');
      bus.publish('test.outbound', { hello: 'world' }, { source: 'test' });

      await new Promise((r) => setTimeout(r, 200));
      expect(received.length).toBe(1);
      const parsed = JSON.parse(received[0]);
      expect(parsed.data).toEqual({ hello: 'world' });

      await listener.quit();
    });

    it('bridgeFromRedis injects Redis messages into the bus', async () => {
      const received: any[] = [];
      bus.subscribe('test.inbound', (event) => {
        received.push(event.data);
      });

      pubsub.bridgeFromRedis('test.inbound');

      const injector = new Redis(REDIS_URL);
      await injector.publish('test.inbound', JSON.stringify({
        topic: 'test.inbound',
        data: { from: 'redis' },
        source: 'external',
      }));

      await new Promise((r) => setTimeout(r, 200));
      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ from: 'redis' });

      await injector.quit();
    });
  });
});
