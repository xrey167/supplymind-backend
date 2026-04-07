import { logger } from '../config/logger';
import { eventBus } from '../events/bus';
import { skillsService } from '../modules/skills/skills.service';
import { skillRegistry } from '../modules/skills/skills.registry';
import { wsServer } from '../infra/realtime/ws-server';
import { skillEmbeddedMcpManager } from '../infra/mcp/embedded-manager';
import { mcpClientPool } from '../infra/mcp/client-pool';
import { createRedisPair } from '../infra/redis/client';
import { RedisPubSub } from '../infra/redis/pubsub';
import { initEventConsumers } from '../events/consumers';
import { getStateStore, closeStateStore } from '../infra/state';
import { setCacheProvider } from '../infra/cache';
import { RedisCache } from '../infra/cache/redis-cache';
import { registerMemorySkills } from '../modules/memory/memory.skills';
import { taskRepo } from '../infra/a2a/task-repo';

let redisPubSub: RedisPubSub | null = null;
let agentWorkerHandles: { worker: import('bullmq').Worker; connection: import('ioredis').default } | null = null;
let jobWorkerHandles: { cleanupWorker: import('bullmq').Worker; syncWorker: import('bullmq').Worker; connection: import('ioredis').default } | null = null;
let idleCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize all subsystems in order.
 * Skills loading is critical — if it fails, startup crashes.
 * Redis and MCP are non-critical — if they fail, we warn and continue.
 */
export async function initSubsystems(app?: import('@hono/zod-openapi').OpenAPIHono): Promise<void> {
  // Step 0: Initialize OTel tracing
  const { initOtel } = await import('../infra/observability/otel');
  await initOtel();

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

  // Register execution skills (A2A)
  try {
    const { registerExecutionSkills } = await import('../modules/execution/execution.skills');
    registerExecutionSkills();
    logger.info('Execution skills registered');
  } catch (err) {
    logger.warn({ err }, 'Failed to register execution skills — non-critical');
  }

  // StateStore + CacheProvider
  const stateStore = getStateStore();
  logger.info({ backend: stateStore.backend }, 'StateStore initialized');

  // Wire Redis cache if Redis is available
  try {
    const redisUrl = Bun.env.REDIS_URL;
    if (redisUrl) {
      const { getSharedRedisClient } = await import('../infra/redis/client');
      const cacheClient = getSharedRedisClient();
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

  // Step 3: Event consumers (logging/observability) — critical
  // Note: WS consumers removed — ws-server now calls the gateway directly
  try {
    initEventConsumers();
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

  // Step 5: MCP client pool — load global MCP server configs from DB (non-critical)
  try {
    const { mcpService } = await import('../modules/mcp/mcp.service');
    await mcpService.loadGlobalServers();
    logger.info('Global MCP server configs loaded');
  } catch (err) {
    logger.warn({ err }, 'Global MCP server load failed — continuing without');
  }

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

  // Step 8: MCP server is now mounted as a Hono route (/mcp) — no standalone init needed
  logger.info('MCP server available at /mcp (Streamable HTTP)');

  // Step 9: Load registered agents from DB into memory (non-critical)
  try {
    const { agentRegistryService } = await import('../modules/agent-registry/agent-registry.service');
    await agentRegistryService.loadAll();
    logger.info('Registered agents loaded from DB');
  } catch (err) {
    logger.warn({ err }, 'Failed to load registered agents — continuing without');
  }

  // Step 10: Start agent BullMQ workers (non-critical)
  try {
    const { startAgentWorkers } = await import('../jobs/agents/index');
    agentWorkerHandles = startAgentWorkers(3);
    logger.info('Agent workers started');
  } catch (err) {
    logger.error({ err }, 'Failed to start agent workers — all task execution is disabled');
  }

  // Step 11: Start orchestration BullMQ workers (non-critical)
  try {
    const { startOrchestrationWorkers } = await import('../jobs/orchestrations');
    startOrchestrationWorkers();
    logger.info('Orchestration workers started');
  } catch (err) {
    logger.error({ err }, 'Failed to start orchestration workers — all orchestration execution is disabled');
  }

  // Step 12: Register repeatable job schedulers
  try {
    const { cleanupQueue, syncQueue } = await import('../infra/queue/bullmq');
    const { Worker } = await import('bullmq');
    const { runCleanup } = await import('../jobs/cleanup');
    const { runSync } = await import('../jobs/sync');
    const Redis = (await import('ioredis')).default;

    const jobConnection = new Redis(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

    await cleanupQueue.upsertJobScheduler('cleanup-sweep', { pattern: '*/15 * * * *' }, { name: 'cleanup' });
    const cleanupWorker = new Worker('cleanup', async () => { await runCleanup(); }, { connection: jobConnection });
    cleanupWorker.on('error', (err) => logger.warn({ err }, 'Cleanup worker error'));

    await syncQueue.upsertJobScheduler('agent-registry-sync', { pattern: '0 * * * *' }, { name: 'agent-sync' });
    const syncWorker = new Worker('sync', async () => { await runSync(); }, { connection: jobConnection });
    syncWorker.on('error', (err) => logger.warn({ err }, 'Sync worker error'));

    jobWorkerHandles = { cleanupWorker, syncWorker, connection: jobConnection };

    logger.info('Step 12: Cleanup and sync job schedulers registered');
  } catch (err) {
    logger.warn({ err }, 'Step 12: Job schedulers failed to register');
  }

  // Step 13: Start ERP sync worker (non-critical)
  try {
    const syncRedis = new (await import('ioredis')).default(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null } as any);
    const { createErpSyncWorker } = await import('../infra/queue/workers/erp-sync.worker');
    const erpSyncWorker = createErpSyncWorker(syncRedis);
    logger.info('ERP sync worker started');
    (globalThis as any).__erpSyncWorker = { worker: erpSyncWorker, connection: syncRedis };
  } catch (err) {
    logger.warn({ err }, 'Failed to start ERP sync worker — non-critical');
  }

  // Step 14: Register plugin health check repeatable job (non-critical)
  try {
    const { Queue, Worker } = await import('bullmq');
    const Redis = (await import('ioredis')).default;
    const healthConnection = new Redis(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null } as any);
    const healthQueue = new Queue('plugin-health', { connection: healthConnection });
    await healthQueue.upsertJobScheduler('plugin-health-check', { every: 5 * 60 * 1000 }, { name: 'health-check' });
    const { processHealthCheckJob } = await import('../infra/queue/workers/plugin-health.worker');
    const healthWorker = new Worker('plugin-health', async () => { await processHealthCheckJob(); }, { connection: healthConnection });
    healthWorker.on('error', (err) => logger.warn({ err }, 'Plugin health worker error'));
    (globalThis as any).__pluginHealthWorker = { worker: healthWorker, connection: healthConnection };
    logger.info('Step 14: Plugin health check worker registered');
  } catch (err) {
    logger.warn({ err }, 'Step 14: Plugin health check worker failed to register — non-critical');
  }

  // Step 16: Register computer use routes (non-critical — requires playwright)
  if (app) {
    try {
      const { computerUseRoutes } = await import('../modules/computer-use/computer-use.routes');
      app.route('/workspaces/:workspaceId/computer-use', computerUseRoutes);
      logger.info('Computer use routes registered');
    } catch (err) {
      logger.warn({ err }, 'Computer use routes failed to register — continuing without computer use');
    }
  }

  // Start idle MCP connection cleanup — runs every 2 minutes
  const IDLE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000;
  const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
  idleCleanupTimer = setInterval(() => {
    try {
      skillEmbeddedMcpManager.cleanupIdle(IDLE_THRESHOLD_MS);
      mcpClientPool.cleanupIdle(IDLE_THRESHOLD_MS);
    } catch (err) {
      logger.warn({ err }, 'MCP idle cleanup error');
    }
  }, IDLE_CLEANUP_INTERVAL_MS);
  // Don't block process exit
  if (typeof idleCleanupTimer === 'object' && 'unref' in idleCleanupTimer) {
    (idleCleanupTimer as any).unref();
  }

  logger.info('Bootstrap complete');
}

/**
 * Gracefully shutdown all subsystems.
 */
export async function destroySubsystems(): Promise<void> {
  if (idleCleanupTimer !== null) {
    clearInterval(idleCleanupTimer);
    idleCleanupTimer = null;
  }
  wsServer.destroy();
  await skillEmbeddedMcpManager.disconnectAll();
  await mcpClientPool.disconnectAll();
  await closeStateStore();
  if (redisPubSub) {
    try {
      await redisPubSub.destroy();
    } catch (err) {
      logger.warn({ err }, 'Failed to destroy Redis pub/sub during shutdown');
    }
  }

  if (agentWorkerHandles) {
    await agentWorkerHandles.worker.close();
    await agentWorkerHandles.connection.quit();
  }

  if (jobWorkerHandles) {
    await jobWorkerHandles.cleanupWorker.close();
    await jobWorkerHandles.syncWorker.close();
    await jobWorkerHandles.connection.quit();
  }

  const erpHandles = (globalThis as any).__erpSyncWorker;
  if (erpHandles) {
    await erpHandles.worker.close();
    await erpHandles.connection.quit();
  }

  // Destroy all computer use sessions (close browsers)
  try {
    const { sessionManager } = await import('../modules/computer-use/computer-use.session');
    await sessionManager.destroyAll();
  } catch (err) {
    const isImportError = err instanceof Error && err.message.includes('Cannot find module');
    if (!isImportError) {
      logger.warn({ err }, 'Computer use session cleanup failed during shutdown');
    }
  }

  // Close shared Redis
  try {
    const { closeSharedRedisClient } = await import('../infra/redis/client');
    await closeSharedRedisClient();
  } catch (err) {
    logger.warn({ err }, 'Failed to close shared Redis client during shutdown');
  }

  // Close DB connection pool
  try {
    const { closeDb } = await import('../infra/db/client');
    await closeDb();
  } catch (err) {
    logger.warn({ err }, 'Failed to close DB connection pool during shutdown');
  }

  // Shutdown OTel
  try {
    const { shutdownOtel } = await import('../infra/observability/otel');
    await shutdownOtel();
  } catch (err) {
    logger.warn({ err }, 'Failed to shutdown OTel during shutdown');
  }

  logger.info('Subsystems destroyed');
}
