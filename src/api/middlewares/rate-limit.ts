import { createMiddleware } from 'hono/factory';
import { logger } from '../../config/logger';

/**
 * Sliding-window rate limiter — per workspace, in-memory.
 *
 * Uses a simple token bucket per workspaceId. Defaults to 200 req/min.
 * For production, swap the in-memory store for Redis (see TODO below).
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/** @internal — exposed for tests only */
export function _resetBuckets() {
  buckets.clear();
}

const DEFAULT_MAX_TOKENS = 200;
const DEFAULT_REFILL_INTERVAL_MS = 60_000; // 1 minute

function getBucket(key: string, maxTokens: number): Bucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: Date.now() };
    buckets.set(key, bucket);
    return bucket;
  }

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= DEFAULT_REFILL_INTERVAL_MS) {
    bucket.tokens = maxTokens;
    bucket.lastRefill = now;
  }

  return bucket;
}

/**
 * Rate limit middleware factory.
 *
 * @param maxRequests — max requests per window (default: 200)
 */
export function rateLimit(maxRequests = DEFAULT_MAX_TOKENS) {
  return createMiddleware(async (c, next) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const key = workspaceId ?? c.req.header('x-forwarded-for') ?? 'global';

    const bucket = getBucket(key, maxRequests);

    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.ceil((DEFAULT_REFILL_INTERVAL_MS - (Date.now() - bucket.lastRefill)) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', '0');
      logger.warn({ key, maxRequests }, 'Rate limit exceeded');
      return c.json({ error: 'Too many requests', retryAfterSec }, 429);
    }

    bucket.tokens--;
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(bucket.tokens));

    return next();
  });
}

/** Default rate limiter (200 req/min per workspace). */
export const rateLimitMiddleware = rateLimit();

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * DEFAULT_REFILL_INTERVAL_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key);
  }
}, 5 * 60_000).unref();
