// src/plugins/erp-bc/skills/get-entity.ts

import { ok, err } from '../../../core/result';
import type { Result } from '../../../core/result';
import { BcClient } from '../connector/bc-client';
import { getToken } from '../connector/bc-auth';
import type { BcEntityType } from '../connector/bc-types';

export async function getEntity(args: Record<string, unknown>): Promise<Result<unknown>> {
  const entityType = args.entityType as BcEntityType;
  const entityId = args.entityId as string;
  const config = args.config as any;

  if (!entityType || !entityId || !config) {
    return err(new Error('entityType, entityId, and config are required'));
  }

  const { getCacheProvider } = await import('../../../infra/cache');
  const cache = getCacheProvider();

  const client = new BcClient(config, {
    get: (key) => cache.get<string>(key).then(v => v ?? null),
    set: (key, value, ttlMs) => cache.set(key, value, ttlMs),
  });

  try {
    const entity = await client.get(entityType, entityId);
    return ok(entity);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
