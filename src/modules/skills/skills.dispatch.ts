import type { DispatchContext, DispatchFn } from './skills.types';
import type { Result } from '../../core/result';
import { err } from '../../core/result';
import { skillRegistry } from './skills.registry';
import { skillExecutor } from './skills.executor';
import { skillCache } from './skills.cache';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

export const dispatchSkill: DispatchFn = async (skillId, args, context) => {
  // Gate 1: License check (placeholder — always passes for now)
  // Gate 2: Billing check (placeholder — always passes for now)
  // Gate 3: RBAC check (placeholder — always passes for now)
  // Gate 4: Workspace membership check (placeholder — always passes for now)

  // Verify skill exists
  if (!skillRegistry.has(skillId)) {
    return err(new Error(`Skill not found: ${skillId}`));
  }

  // Check cache
  const cached = skillCache.get(skillId, args);
  if (cached !== undefined) return { ok: true, value: cached } as Result<unknown>;

  // Execute with concurrency control
  const start = Date.now();
  const result = await skillExecutor.execute(skillId, () => skillRegistry.invoke(skillId, args));
  const durationMs = Date.now() - start;

  // Cache on success
  if (result.ok) {
    skillCache.set(skillId, args, result.value);
  }

  // Emit event
  eventBus.emit(Topics.SKILL_INVOKED, {
    name: skillId,
    durationMs,
    success: result.ok,
    workspaceId: context.workspaceId,
    callerId: context.callerId,
  });

  return result;
};
