import { logger } from '../config/logger';
import { eventBus } from '../events/bus';
import { skillsService } from '../modules/skills/skills.service';
import { skillRegistry } from '../modules/skills/skills.registry';
import { wsServer } from '../infra/realtime/ws-server';
import { mcpClientPool } from '../infra/mcp/client-pool';
import { createRedisPair } from '../infra/redis/client';
import { RedisPubSub } from '../infra/redis/pubsub';
import { initEventConsumers } from '../events/consumers';
import { initWsConsumers } from '../events/consumers/ws-consumers';

let redisPubSub: RedisPubSub | null = null;

/**
 * Initialize all subsystems in order.
 * Skills loading is critical — if it fails, startup crashes.
 * Redis and MCP are non-critical — if they fail, we warn and continue.
 */
export async function initSubsystems(): Promise<void> {
  // Step 1: Load skills (builtin + DB)
  try {
    await skillsService.loadSkills();
    logger.info({ count: skillRegistry.list().length }, 'Skills loaded');
  } catch (err) {
    logger.error({ error: err }, 'Failed to load skills');
    throw err; // Skills are critical — fail startup
  }

  // Step 2: WebSocket server
  wsServer.init();
  logger.info('WebSocket server initialized');

  // Step 3: Event consumers (logging + WS handlers) — critical
  try {
    initEventConsumers();
    initWsConsumers();
    logger.info('Event consumers initialized');
  } catch (err) {
    logger.error({ error: err }, 'Failed to initialize event consumers');
    throw err;
  }

  // Step 4: Redis pub/sub bridge (non-critical — warn on failure)
  try {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const { publisher, subscriber } = createRedisPair(redisUrl);
    redisPubSub = new RedisPubSub(eventBus, publisher, subscriber);
    redisPubSub.bridgeToRedis('task.#');
    redisPubSub.bridgeFromRedis('task.#');
    redisPubSub.bridgeToRedis('collaboration.#');
    redisPubSub.bridgeFromRedis('collaboration.#');
    logger.info('Redis pub/sub bridge initialized');
  } catch (err) {
    logger.warn({ error: err }, 'Redis pub/sub bridge failed to initialize — continuing without it');
  }

  // Step 5: MCP client pool — load remote tools as skills (non-critical)
  // TODO: Load MCP server configs from DB when workspace context is available
  // For now, skip MCP init — configs will come from DB via API later
  logger.info('Bootstrap complete');
}

/**
 * Gracefully shutdown all subsystems.
 */
export async function destroySubsystems(): Promise<void> {
  wsServer.destroy();
  await mcpClientPool.disconnectAll();
  // Redis cleanup is handled by ioredis automatically on disconnect
  logger.info('Subsystems destroyed');
}
