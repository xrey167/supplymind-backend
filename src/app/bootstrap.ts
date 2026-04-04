import { logger } from '../config/logger';
import { eventBus } from '../events/bus';
import { skillsService } from '../modules/skills/skills.service';
import { skillRegistry } from '../modules/skills/skills.registry';
import { wsServer } from '../infra/realtime/ws-server';
import { mcpClientPool } from '../infra/mcp/client-pool';
import { createRedisPair, createRedisClient } from '../infra/redis/client';
import { RedisPubSub } from '../infra/redis/pubsub';
import { initEventConsumers } from '../events/consumers';
import { initWsConsumers } from '../events/consumers/ws-consumers';
import { getStateStore, closeStateStore } from '../infra/state';
import { setCacheProvider } from '../infra/cache';
import { RedisCache } from '../infra/cache/redis-cache';
import { registerMemorySkills } from '../modules/memory/memory.skills';
import { taskRepo } from '../infra/a2a/task-repo';

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

  // Register memory skills (remember, recall, propose_memory, forget)
  registerMemorySkills();
  logger.info('Memory skills registered');

  // StateStore + CacheProvider
  const stateStore = getStateStore();
  logger.info({ backend: stateStore.backend }, 'StateStore initialized');

  // Wire Redis cache if Redis is available
  try {
    const redisUrl = Bun.env.REDIS_URL;
    if (redisUrl) {
      const cacheClient = createRedisClient(redisUrl);
      setCacheProvider(new RedisCache(cacheClient));
      logger.info('CacheProvider: Redis');
    } else {
      logger.info('CacheProvider: Memory (no REDIS_URL)');
    }
  } catch (err) {
    logger.warn({ error: err }, 'Redis cache init failed — using memory cache');
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
    const redisUrl = Bun.env.REDIS_URL ?? 'redis://localhost:6379';
    const { publisher, subscriber } = createRedisPair(redisUrl);
    redisPubSub = new RedisPubSub(eventBus, publisher, subscriber);
    redisPubSub.bridgeToRedis('task.#');
    redisPubSub.bridgeFromRedis('task.#');
    redisPubSub.bridgeToRedis('collaboration.#');
    redisPubSub.bridgeFromRedis('collaboration.#');
    redisPubSub.bridgeToRedis('session.#');
    redisPubSub.bridgeFromRedis('session.#');
    redisPubSub.bridgeToRedis('memory.#');
    redisPubSub.bridgeFromRedis('memory.#');
    redisPubSub.bridgeToRedis('orchestration.#');
    redisPubSub.bridgeFromRedis('orchestration.#');
    logger.info('Redis pub/sub bridge initialized');
  } catch (err) {
    logger.warn({ error: err }, 'Redis pub/sub bridge failed to initialize — continuing without it');
  }

  // Step 5: MCP client pool — load remote tools as skills (non-critical)
  // TODO: Load MCP server configs from DB when workspace context is available
  // For now, skip MCP init — configs will come from DB via API later

  // Step 6 (original): Load tool definitions from DB into skill registry (non-critical)
  try {
    const { toolsService } = await import('../modules/tools/tools.service');
    const tools = await toolsService.loadToolsFromDb();
    logger.info({ toolCount: tools.length }, 'Tool definitions loaded from DB');
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Failed to load tools from DB — continuing without DB tools');
  }

  // Step 7: Recover stale tasks from prior run (non-critical)
  try {
    const staleStatuses = ['working', 'submitted'] as const;
    for (const status of staleStatuses) {
      const staleTasks = await taskRepo.findByStatus(status);
      for (const t of staleTasks) {
        await taskRepo.updateStatus(t.id, 'failed');
        logger.warn({ taskId: t.id, status }, 'Marked stale task as failed on startup');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Stale task recovery failed — continuing');
  }

  // Step 8: Start MCP server — expose skills as MCP tools (non-critical)
  try {
    const { createMcpServer } = await import('../infra/mcp/server');
    createMcpServer();
    logger.info('MCP server initialized');
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Failed to initialize MCP server — MCP tools unavailable');
  }

  // Step 9: Load registered agents from DB into memory (non-critical)
  try {
    const { agentRegistryService } = await import('../modules/agent-registry/agent-registry.service');
    await agentRegistryService.loadAll();
    logger.info('Registered agents loaded from DB');
  } catch (err) {
    logger.warn({ err }, 'Failed to load registered agents — continuing without');
  }

  logger.info('Bootstrap complete');
}

/**
 * Gracefully shutdown all subsystems.
 */
export async function destroySubsystems(): Promise<void> {
  wsServer.destroy();
  await mcpClientPool.disconnectAll();
  await closeStateStore();
  // Redis cleanup is handled by ioredis automatically on disconnect
  logger.info('Subsystems destroyed');
}
