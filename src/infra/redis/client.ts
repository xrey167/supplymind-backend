import Redis from 'ioredis';

/**
 * Factory function to create a single Redis client
 * @param url - Redis connection URL
 * @returns A new Redis client instance
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url);
}

/**
 * Factory function to create a publisher/subscriber pair
 *
 * ioredis requires two separate connections because a subscriber connection
 * cannot be used for regular commands (it's in subscribe mode only).
 *
 * @param url - Redis connection URL
 * @returns Object with separate publisher and subscriber Redis instances
 */
export function createRedisPair(url: string): {
  publisher: Redis;
  subscriber: Redis;
} {
  return {
    publisher: new Redis(url),
    subscriber: new Redis(url),
  };
}

/**
 * Create a Redis connection suitable for BullMQ workers and queues.
 * maxRetriesPerRequest: null is required by BullMQ — without it, blocked
 * commands time out instead of waiting, causing unexpected job failures.
 */
export function createWorkerRedisConnection(url?: string): Redis {
  return new Redis(url ?? Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
}

let sharedClient: Redis | null = null;

export function getSharedRedisClient(): Redis {
  if (!sharedClient) {
    const url = Bun.env.REDIS_URL ?? 'redis://localhost:6379';
    sharedClient = new Redis(url);
  }
  return sharedClient;
}

export async function closeSharedRedisClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit();
    sharedClient = null;
  }
}
