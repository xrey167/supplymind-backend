// src/plugins/erp-bc/skills/post-action.ts

import { ok, err } from '../../../core/result';
import type { Result } from '../../../core/result';
import { BcClient } from '../connector/bc-client';
import type { BcEntityType } from '../connector/bc-types';

const HITL_REQUIRED_ACTIONS = new Set(['postInvoice', 'deleteVendor', 'cancelOrder', 'modifyGLEntry']);

/**
 * Execute a BC write action.
 * HITL-eligible actions must come from inside an approved ExecutionPlan (gate step must have passed).
 */
export async function postAction(args: Record<string, unknown>): Promise<Result<unknown>> {
  const actionName = args.actionName as string;
  const entityType = args.entityType as BcEntityType;
  const entityId = args.entityId as string;
  const config = args.config as any;
  const _calledFromPlan = args._calledFromPlan as boolean | undefined;

  if (!actionName || !entityType || !entityId || !config) {
    return err(new Error('actionName, entityType, entityId, and config are required'));
  }

  if (HITL_REQUIRED_ACTIONS.has(actionName) && !_calledFromPlan) {
    return err(new Error(`Action '${actionName}' requires HITL approval. Use createApprovalGateForWriteAction().`));
  }

  const { getCacheProvider } = await import('../../../infra/cache');
  const cache = getCacheProvider();

  const client = new BcClient(config, {
    get: (key) => cache.get<string>(key).then(v => v ?? null),
    set: (key, value, ttlMs) => cache.set(key, value, ttlMs),
  });

  try {
    await client.action(entityType, entityId, actionName, args.payload);
    return ok({ actionName, entityType, entityId, executed: true });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
