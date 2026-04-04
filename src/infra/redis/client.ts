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
