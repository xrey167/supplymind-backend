import { db } from '../../infra/db/client';
import { getSharedRedisClient } from '../../infra/redis/client';
import { sql } from 'drizzle-orm';
import { logger } from '../../config/logger';

type CheckStatus = 'ok' | 'error';

interface ReadinessResult {
  status: 'ready' | 'degraded';
  checks: { db: CheckStatus; redis: CheckStatus };
}

async function checkDb(): Promise<CheckStatus> {
  try {
    await db.execute(sql`SELECT 1`);
    return 'ok';
  } catch (err) {
    logger.warn({ err }, 'Health: DB check failed');
    return 'error';
  }
}

async function checkRedis(): Promise<CheckStatus> {
  try {
    await getSharedRedisClient().ping();
    return 'ok';
  } catch (err) {
    logger.warn({ err }, 'Health: Redis check failed');
    return 'error';
  }
}

export const healthService = {
  async readiness(): Promise<ReadinessResult> {
    const [dbStatus, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
    const allOk = dbStatus === 'ok' && redisStatus === 'ok';
    return {
      status: allOk ? 'ready' : 'degraded',
      checks: { db: dbStatus, redis: redisStatus },
    };
  },
};
