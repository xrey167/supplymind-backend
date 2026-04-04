import type { DispatchContext, DispatchFn } from './skills.types';
import type { Result } from '../../core/result';
import { err } from '../../core/result';
import { AbortError } from '../../core/errors';
import { skillRegistry } from './skills.registry';
import { skillExecutor } from './skills.executor';
import { skillCache } from './skills.cache';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { withSpan } from '../../infra/observability/otel';
import { hooksRegistry } from '../tools/tools.hooks';
import { logger } from '../../config/logger';
import { captureException } from '../../infra/observability/sentry';
import { hasPermission, getRequiredRole, Roles } from '../../core/security/rbac';
import { workspaceSettingsService } from '../settings/workspace-settings/workspace-settings.service';

export const dispatchSkill: DispatchFn = async (skillId, args, context) => {
  if (context.signal?.aborted) {
    return err(new AbortError('Skill dispatch aborted', 'system'));
  }
  return withSpan('skill.dispatch', {
    'skill.name': skillId,
    'caller.id': context.callerId,
    'workspace.id': context.workspaceId,
    'caller.role': context.callerRole,
  }, async (span) => {
    // Gate 1: License check (placeholder — always passes for now)
    // Gate 2: Billing check (placeholder — always passes for now)

    // Verify skill exists (needed before RBAC to get providerType)
    const skill = skillRegistry.get(skillId);
    if (!skill) {
      return err(new Error(`Skill not found: ${skillId}`));
    }

    // Gate 3: RBAC — caller role must meet the minimum required for this skill's provider type
    const requiredRole = getRequiredRole(skill.providerType);
    if (!hasPermission(context.callerRole, requiredRole)) {
      eventBus.publish(Topics.SECURITY_RBAC_DENIED, {
        skillId, callerRole: context.callerRole, requiredRole, workspaceId: context.workspaceId, callerId: context.callerId,
      });
      return err(new Error(`Permission denied: role '${context.callerRole}' cannot invoke '${skillId}' (requires '${requiredRole}')`));
    }

    // Gate 3b: Tool permission mode — workspace-level execution policy
    const permissionMode = await workspaceSettingsService.getToolPermissionMode(context.workspaceId);
    if (permissionMode === 'strict' && !hasPermission(context.callerRole, Roles.ADMIN)) {
      eventBus.publish(Topics.SECURITY_PERMISSION_MODE_BLOCKED, {
        skillId, callerRole: context.callerRole, workspaceId: context.workspaceId, mode: 'strict',
      });
      return err(new Error(`Tool execution blocked: workspace '${context.workspaceId}' is in strict mode (admin-only)`));
    }
    if (permissionMode === 'ask' && context.callerRole === Roles.AGENT) {
      eventBus.publish(Topics.SECURITY_PERMISSION_MODE_BLOCKED, {
        skillId, callerRole: context.callerRole, workspaceId: context.workspaceId, mode: 'ask',
      });
      return err(new Error(`Tool execution requires approval: workspace '${context.workspaceId}' is in ask mode`));
    }

    // Gate 4: Workspace membership check (placeholder — always passes for now)

    // beforeExecute hook
    const hooks = hooksRegistry.get(skillId);
    if (hooks?.beforeExecute) {
      const hookCtx = {
        callerId: context.callerId,
        workspaceId: context.workspaceId,
        traceId: context.traceId,
      };
      let hookResult: Awaited<ReturnType<typeof hooks.beforeExecute>>;
      try {
        hookResult = await hooks.beforeExecute(args, hookCtx);
      } catch (hookError: unknown) {
        logger.error({ skillId, error: hookError }, 'beforeExecute hook threw unexpectedly');
        captureException(hookError, { skillId, callerId: context.callerId });
        return err(new Error(`beforeExecute hook failed for skill ${skillId}`));
      }
      if (!hookResult.allow) {
        return err(new Error(hookResult.reason ?? `Tool ${skillId} blocked by beforeExecute hook`));
      }
      if (hookResult.modifiedArgs !== undefined) {
        args = hookResult.modifiedArgs as Record<string, unknown>;
      }
    }

    // Check cache
    const cached = await skillCache.get(skillId, args);
    if (cached !== undefined) {
      span.setAttribute('cache.hit', true);
      return { ok: true, value: cached } as Result<unknown>;
    }

    // Execute with concurrency control
    const start = Date.now();
    const result = await skillExecutor.execute(skillId, () => skillRegistry.invoke(skillId, args, context));
    const durationMs = Date.now() - start;

    span.setAttribute('duration_ms', durationMs);
    span.setAttribute('success', result.ok);

    // Cache on success
    if (result.ok) {
      await skillCache.set(skillId, args, result.value);
    }

    // Emit event
    eventBus.publish(Topics.SKILL_INVOKED, {
      name: skillId,
      durationMs,
      success: result.ok,
      workspaceId: context.workspaceId,
      callerId: context.callerId,
    });

    // afterExecute hook — errors swallowed
    if (hooks?.afterExecute) {
      const hookCtx = {
        callerId: context.callerId,
        workspaceId: context.workspaceId,
        traceId: context.traceId,
      };
      await hooks.afterExecute(args, result, hookCtx).catch((hookError: unknown) => {
        logger.error({ skillId, error: hookError }, 'afterExecute hook threw — swallowed');
        captureException(hookError, { skillId, callerId: context.callerId });
      });
    }

    return result;
  });
};
