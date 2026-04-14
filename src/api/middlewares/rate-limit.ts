import { createMiddleware } from 'hono/factory';
import type Redis from 'ioredis';
import { logger } from '../../config/logger';

/**
 * Token-bucket rate limiter — per workspace, Redis-backed.
 *
 * Uses an atomic Lua script to check and decrement a token bucket stored in
 * Redis. Defaults to 200 req/min. Fails open when Redis is unavailable.
 */

// ---------------------------------------------------------------------------
// Lua script — atomic token-bucket check-and-decrement
// KEYS[1] = rate limit key (e.g. "rl:ws-abc123")
// ARGV[1] = maxTokens (string)
// ARGV[2] = refillIntervalMs (string)
// ARGV[3] = now as ms timestamp (string)
// ARGV[4] = ttl in seconds (string)
// Returns: [1|0 (allowed), remainingTokens]
// ---------------------------------------------------------------------------
const RATE_LIMIT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local tokens, lastRefill
if raw then
  local data = cjson.decode(raw)
  tokens = data.tokens
  lastRefill = data.lastRefill
else
  tokens = tonumber(ARGV[1])
  lastRefill = tonumber(ARGV[3])
end
local elapsed = tonumber(ARGV[3]) - lastRefill
local refilled = math.floor(elapsed / tonumber(ARGV[2])) * tonumber(ARGV[1])
if refilled > 0 then
  tokens = math.min(tonumber(ARGV[1]), tokens + refilled)
  lastRefill = tonumber(ARGV[3])
end
local allowed = tokens > 0
if allowed then tokens = tokens - 1 end
redis.call('SET', KEYS[1], cjson.encode({tokens=tokens, lastRefill=lastRefill}), 'EX', ARGV[4])
return {allowed and 1 or 0, tokens}
`;

// ---------------------------------------------------------------------------
// Extend the Redis type with the custom command
// ---------------------------------------------------------------------------
type RedisWithRateCheck = Redis & {
  rateLimitCheck(
    key: string,
    maxTokens: string,
    refillMs: string,
    now: string,
    ttl: string,
  ): Promise<[number, number]>;
};

function getRedis(): RedisWithRateCheck {
  // Use require() for lazy loading — avoids establishing a Redis connection at
  // module load time, which would break tests that mock the client.
  const { getSharedRedisClient } = require('../../infra/redis/client');
  const client = getSharedRedisClient() as RedisWithRateCheck;
  if (!(client as any).__rateLimitDefined) {
    client.defineCommand('rateLimitCheck', {
      numberOfKeys: 1,
      lua: RATE_LIMIT_SCRIPT,
    });
    (client as any).__rateLimitDefined = true;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_MAX_TOKENS = 200;
const DEFAULT_REFILL_INTERVAL_MS = 60_000; // 1 minute

/** @internal — no-op; exists so tests can import without breaking. Redis state is reset by mocking. */
export function _resetBuckets() {}

/**
 * Rate limit middleware factory.
 *
 * @param maxRequests — max requests per window (default: 200)
 * @param refillIntervalMs — window duration in ms (default: 60 000)
 */
export function rateLimit(
  maxRequests = DEFAULT_MAX_TOKENS,
  refillIntervalMs = DEFAULT_REFILL_INTERVAL_MS,
) {
  return createMiddleware(async (c, next) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const key = `rl:${workspaceId ?? c.req.header('x-forwarded-for') ?? 'global'}`;
    const ttlSeconds = Math.ceil((refillIntervalMs * 2) / 1000);

    let allowed = true;
    let remaining = maxRequests - 1;

    try {
      const redis = getRedis();
      const result = await redis.rateLimitCheck(
        key,
        String(maxRequests),
        String(refillIntervalMs),
        String(Date.now()),
        String(ttlSeconds),
      );
      allowed = result[0] === 1;
      remaining = result[1];
    } catch (err) {
      // Fail-open: Redis unavailable — allow the request
      logger.warn({ err, key }, 'Rate limiter Redis error — failing open');
    }

    if (!allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(refillIntervalMs / 1000));
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', '0');
      logger.warn({ key, maxRequests }, 'Rate limit exceeded');
      return c.json({ error: 'Too many requests', retryAfterSec }, 429);
    }

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    return next();
  });
}

/** Default rate limiter (200 req/min per workspace). */
export const rateLimitMiddleware = rateLimit();

export interface PluginRateLimitConfig {
  windowMs: number;
  max: number;
}

export const PLUGIN_RATE_LIMITS: Record<string, PluginRateLimitConfig> = {
  default: { windowMs: 60_000, max: 200 },
  'erp-bc': { windowMs: 60_000, max: 60 },
  'execution-layer': { windowMs: 60_000, max: 100 },
};

/** Returns the rate limit config for a plugin, falling back to default. */
export function pluginRateLimit(pluginId: string): PluginRateLimitConfig {
  return PLUGIN_RATE_LIMITS[pluginId] ?? PLUGIN_RATE_LIMITS.default;
}
