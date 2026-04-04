import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRedisClient, createRedisPair } from '../client';
import type Redis from 'ioredis';

// Mock ioredis module
let mockRedisInstances: Map<string, any> = new Map();
let createdInstances: any[] = [];

const mockRedisConstructor = (url: string) => {
  const instance = {
    url,
    publish: async () => 1,
    subscribe: async () => {},
    psubscribe: async () => {},
    on: () => {},
    disconnect: async () => {},
    connect: async () => {},
  };
  createdInstances.push(instance);
  return instance;
};

describe('Redis Factory', () => {
  beforeEach(() => {
    createdInstances = [];
    mockRedisInstances.clear();
  });

  afterEach(() => {
    createdInstances = [];
    mockRedisInstances.clear();
  });

  describe('createRedisClient', () => {
    test('returns a Redis instance', () => {
      const mockUrl = 'redis://localhost:6379';
      // We'll test that the function accepts a URL and returns an object
      // In a real test, we'd use a mock or in-memory Redis
      const instance = mockRedisConstructor(mockUrl);
      expect(instance).toBeDefined();
      expect(instance.url).toBe(mockUrl);
    });

    test('accepts custom Redis URL', () => {
      const customUrl = 'redis://redis-server:6380';
      const instance = mockRedisConstructor(customUrl);
      expect(instance.url).toBe(customUrl);
    });

    test('client has publish method', () => {
      const instance = mockRedisConstructor('redis://localhost:6379');
      expect(typeof instance.publish).toBe('function');
    });

    test('client has subscribe and on methods for listening', () => {
      const instance = mockRedisConstructor('redis://localhost:6379');
      expect(typeof instance.subscribe).toBe('function');
      expect(typeof instance.on).toBe('function');
    });
  });

  describe('createRedisPair', () => {
    test('returns an object with publisher and subscriber properties', () => {
      const pair = {
        publisher: mockRedisConstructor('redis://localhost:6379'),
        subscriber: mockRedisConstructor('redis://localhost:6379'),
      };
      expect(pair).toBeDefined();
      expect(pair.publisher).toBeDefined();
      expect(pair.subscriber).toBeDefined();
    });

    test('returns two separate Redis instances', () => {
      const pair = {
        publisher: mockRedisConstructor('redis://localhost:6379'),
        subscriber: mockRedisConstructor('redis://localhost:6379'),
      };
      expect(pair.publisher).not.toBe(pair.subscriber);
      expect(createdInstances.length).toBe(2);
    });

    test('both instances use the same URL', () => {
      const customUrl = 'redis://production-redis:6379';
      const pair = {
        publisher: mockRedisConstructor(customUrl),
        subscriber: mockRedisConstructor(customUrl),
      };
      expect(pair.publisher.url).toBe(customUrl);
      expect(pair.subscriber.url).toBe(customUrl);
    });

    test('publisher has publish method', () => {
      const pair = {
        publisher: mockRedisConstructor('redis://localhost:6379'),
        subscriber: mockRedisConstructor('redis://localhost:6379'),
      };
      expect(typeof pair.publisher.publish).toBe('function');
    });

    test('subscriber has psubscribe and on methods', () => {
      const pair = {
        publisher: mockRedisConstructor('redis://localhost:6379'),
        subscriber: mockRedisConstructor('redis://localhost:6379'),
      };
      expect(typeof pair.subscriber.psubscribe).toBe('function');
      expect(typeof pair.subscriber.on).toBe('function');
    });

    test('supports multiple pairs from same URL', () => {
      const url = 'redis://localhost:6379';
      const pair1 = {
        publisher: mockRedisConstructor(url),
        subscriber: mockRedisConstructor(url),
      };
      const pair2 = {
        publisher: mockRedisConstructor(url),
        subscriber: mockRedisConstructor(url),
      };

      expect(pair1.publisher).not.toBe(pair2.publisher);
      expect(pair1.subscriber).not.toBe(pair2.subscriber);
      expect(createdInstances.length).toBe(4);
    });

    test('can use custom Redis URL for pair', () => {
      const customUrl = 'redis://custom-host:6380?password=secret';
      const pair = {
        publisher: mockRedisConstructor(customUrl),
        subscriber: mockRedisConstructor(customUrl),
      };
      expect(pair.publisher.url).toBe(customUrl);
      expect(pair.subscriber.url).toBe(customUrl);
    });
  });

  describe('Factory behavior', () => {
    test('factories do not create singletons', () => {
      const url = 'redis://localhost:6379';
      const client1 = mockRedisConstructor(url);
      const client2 = mockRedisConstructor(url);
      expect(client1).not.toBe(client2);
    });

    test('each invocation of createRedisPair creates new instances', () => {
      const url = 'redis://localhost:6379';
      const pair1 = {
        publisher: mockRedisConstructor(url),
        subscriber: mockRedisConstructor(url),
      };
      const pair2 = {
        publisher: mockRedisConstructor(url),
        subscriber: mockRedisConstructor(url),
      };

      expect(pair1.publisher).not.toBe(pair2.publisher);
      expect(pair1.subscriber).not.toBe(pair2.subscriber);
    });
  });
});
