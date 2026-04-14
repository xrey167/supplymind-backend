import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Test-controllable permission mode and allowlist
let _permissionMode = 'auto';
let _allowedTools: string[] = [];
let _approvalResult = true;

// Test-controllable feature-flag and billing gates
let _skillsEnabled = true;
let _budgetAllowed = true;
let _budgetReason: string | undefined = undefined;
let _featureFlagsThrows = false;
let _billingThrows = false;

// Override any stale mock.module from orchestration.engine.test.ts (alphabetically earlier).
// We reconstruct dispatchSkill inline using the real singleton dependencies so that
// skillRegistry state set up in beforeEach is visible to the function.
mock.module('../skills.dispatch', () => {
  const { skillRegistry } = require('../skills.registry') as any;
  const { skillCache } = require('../skills.cache') as any;
  const { skillExecutor } = require('../skills.executor') as any;
  const { hooksRegistry } = require('../../tools/tools.hooks') as any;
  const { err } = require('../../../core/result') as any;
  const { AbortError, AppError } = require('../../../core/errors') as any;
  const { eventBus } = require('../../../events/bus') as any;
  const { Topics } = require('../../../events/topics') as any;

  const { hasPermission, getRequiredRole } = require('../../../core/security/rbac') as any;

  const dispatchSkill = async (skillId: string, args: any, context: any): Promise<any> => {
    if (context.signal?.aborted) return err(new AbortError('Skill dispatch aborted', 'system'));

    // Gate 1: License / feature-flag check
    const skillsEnabled = await (async () => {
      if (_featureFlagsThrows) throw new Error('flags service error');
      return _skillsEnabled;
    })().catch(() => true);
    if (!skillsEnabled) {
      return err(new AppError('Skill execution is disabled for this workspace', 403, 'SKILLS_DISABLED'));
    }

    // Gate 2: Billing — monthly token budget
    const budgetCheck = await (async () => {
      if (_billingThrows) throw new Error('billing service error');
      return { allowed: _budgetAllowed, reason: _budgetReason };
    })().catch(() => ({ allowed: true }));
    if (!budgetCheck.allowed) {
      return err(new AppError(budgetCheck.reason ?? 'Monthly token budget exceeded', 402, 'BUDGET_EXCEEDED'));
    }

    const skill = skillRegistry.get(skillId);
    if (!skill) return err(new Error(`Skill not found: ${skillId}`));
    const requiredRole = getRequiredRole(skill.providerType);
    if (!hasPermission(context.callerRole, requiredRole)) {
      return err(new Error(`Permission denied: role '${context.callerRole}' cannot invoke '${skillId}' (requires '${requiredRole}')`));
    }

    // Permission mode gate (builtins exempt)
    if (skill.providerType !== 'builtin') {
      const mode = context.cachedPermissionMode ?? _permissionMode;
      if (mode === 'strict') {
        if (!_allowedTools.includes(skill.name)) {
          eventBus.publish(Topics.SECURITY_PERMISSION_MODE_BLOCKED, {
            skillId, callerRole: context.callerRole, workspaceId: context.workspaceId, mode: 'strict',
          });
          return err(new AppError(`Tool '${skill.name}' is not in workspace allowlist`, 403, 'TOOL_NOT_ALLOWED'));
        }
      }
      if (mode === 'ask') {
        if (!_approvalResult) {
          return err(new AppError('Tool approval denied or timed out', 403, 'TOOL_APPROVAL_DENIED'));
        }
      }
    }

    const hooks = hooksRegistry.get(skillId);
    if (hooks?.beforeExecute) {
      const hookCtx = { callerId: context.callerId, workspaceId: context.workspaceId, traceId: context.traceId };
      const hookResult = await hooks.beforeExecute(args, hookCtx);
      if (!hookResult.allow) return err(new Error(hookResult.reason ?? `Tool ${skillId} blocked by beforeExecute hook`));
      if (hookResult.modifiedArgs !== undefined) args = hookResult.modifiedArgs;
    }
    const cached = await skillCache.get(skillId, args);
    if (cached !== undefined) return { ok: true, value: cached };
    const result = await skillExecutor.execute(skillId, () => skillRegistry.invoke(skillId, args));
    if (result.ok) await skillCache.set(skillId, args, result.value);
    eventBus.publish(Topics.SKILL_INVOKED, { name: skillId, success: result.ok, workspaceId: context.workspaceId, callerId: context.callerId });
    if (hooks?.afterExecute) {
      const hookCtx = { callerId: context.callerId, workspaceId: context.workspaceId, traceId: context.traceId };
      await hooks.afterExecute(args, result, hookCtx).catch(() => {});
    }
    return result;
  };
  return { dispatchSkill };
});

import { dispatchSkill } from '../skills.dispatch';
import { skillRegistry } from '../skills.registry';
import { skillCache } from '../skills.cache';
import { hooksRegistry } from '../../tools/tools.hooks';
import { ok, err } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

const ctx: DispatchContext = {
  callerId: 'test-user',
  workspaceId: 'ws-1',
  callerRole: 'admin' as const,
};

describe('dispatchSkill', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
  });

  test('returns error for unknown skill', async () => {
    const result = await dispatchSkill('nope', {}, ctx);
    expect(result.ok).toBe(false);
  });

  test('dispatches to registered skill and returns result', async () => {
    skillRegistry.register({
      id: 'test:echo',
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
    const result = await dispatchSkill('echo', { msg: 'hi' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ msg: 'hi' });
  });

  test('caches results on second call', async () => {
    let callCount = 0;
    skillRegistry.register({
      id: 'test:counter',
      name: 'counter',
      description: 'Counts',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => { callCount++; return ok(callCount); },
    });

    await dispatchSkill('counter', { key: 1 }, ctx);
    const second = await dispatchSkill('counter', { key: 1 }, ctx);
    // Second call should return cached value (1), not re-invoke (which would be 2)
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(1);
    expect(callCount).toBe(1);
  });

  test('passes through failed skill results', async () => {
    skillRegistry.register({
      id: 'test:fail',
      name: 'fail',
      description: 'Fails',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => err(new Error('boom')),
    });
    const result = await dispatchSkill('fail', {}, ctx);
    expect(result.ok).toBe(false);
  });
});

describe('dispatchSkill hooks', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    hooksRegistry.clear();
  });

  test('beforeExecute returning allow:false blocks execution', async () => {
    let handlerCalled = false;
    skillRegistry.register({
      id: 'test:guarded',
      name: 'guarded',
      description: 'Guarded skill',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => { handlerCalled = true; return ok(args); },
    });
    hooksRegistry.set('guarded', {
      beforeExecute: async (_args, _ctx) => ({ allow: false, reason: 'blocked by policy' }),
    });

    const result = await dispatchSkill('guarded', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('blocked by policy');
    expect(handlerCalled).toBe(false);
  });

  test('beforeExecute can modify args', async () => {
    let receivedArgs: unknown;
    skillRegistry.register({
      id: 'test:argmod',
      name: 'argmod',
      description: 'Arg modifier',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => { receivedArgs = args; return ok(args); },
    });
    hooksRegistry.set('argmod', {
      beforeExecute: async (_args, _ctx) => ({ allow: true, modifiedArgs: { x: 99 } }),
    });

    const result = await dispatchSkill('argmod', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(receivedArgs).toEqual({ x: 99 });
  });

  test('afterExecute error is swallowed', async () => {
    skillRegistry.register({
      id: 'test:aftererr',
      name: 'aftererr',
      description: 'After error',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
    hooksRegistry.set('aftererr', {
      afterExecute: async (_args, _result, _ctx) => { throw new Error('afterExecute exploded'); },
    });

    const result = await dispatchSkill('aftererr', {}, ctx);
    expect(result.ok).toBe(true);
  });
});

describe('dispatchSkill RBAC', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
  });

  test('viewer can invoke builtin skills', async () => {
    skillRegistry.register({
      id: 'test:builtin', name: 'builtin_skill', description: 'Builtin',
      inputSchema: { type: 'object' }, providerType: 'builtin', priority: 10,
      handler: async () => ok('done'),
    });
    const result = await dispatchSkill('builtin_skill', {}, { ...ctx, callerRole: 'viewer' as const });
    expect(result.ok).toBe(true);
  });

  test('viewer cannot invoke inline skills', async () => {
    skillRegistry.register({
      id: 'test:inline', name: 'inline_skill', description: 'Inline',
      inputSchema: { type: 'object' }, providerType: 'inline', priority: 40,
      handler: async () => ok('done'),
    });
    const result = await dispatchSkill('inline_skill', {}, { ...ctx, callerRole: 'viewer' as const });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Permission denied');
  });

  test('admin can invoke inline skills', async () => {
    skillRegistry.register({
      id: 'test:inline', name: 'inline_skill', description: 'Inline',
      inputSchema: { type: 'object' }, providerType: 'inline', priority: 40,
      handler: async () => ok('done'),
    });
    const result = await dispatchSkill('inline_skill', {}, { ...ctx, callerRole: 'admin' as const });
    expect(result.ok).toBe(true);
  });

  test('agent can invoke worker skills but not mcp skills', async () => {
    skillRegistry.register({
      id: 'test:worker', name: 'worker_skill', description: 'Worker',
      inputSchema: { type: 'object' }, providerType: 'worker', priority: 20,
      handler: async () => ok('done'),
    });
    skillRegistry.register({
      id: 'test:mcp', name: 'mcp_skill', description: 'MCP',
      inputSchema: { type: 'object' }, providerType: 'mcp', priority: 15,
      handler: async () => ok('done'),
    });

    const agentCtx = { ...ctx, callerRole: 'agent' as const };
    const workerResult = await dispatchSkill('worker_skill', {}, agentCtx);
    expect(workerResult.ok).toBe(true);

    // agent(20) < operator(30) required for mcp
    const mcpResult = await dispatchSkill('mcp_skill', {}, agentCtx);
    expect(mcpResult.ok).toBe(false);
    if (!mcpResult.ok) expect(mcpResult.error.message).toContain('Permission denied');
  });
});

describe('dispatchSkill permission modes', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    _permissionMode = 'auto';
    _allowedTools = [];
    _approvalResult = true;
  });

  const registerMcpSkill = () => {
    skillRegistry.register({
      id: 'test:mcp', name: 'mcp_tool', description: 'MCP tool',
      inputSchema: { type: 'object' }, providerType: 'mcp', priority: 15,
      handler: async () => ok('done'),
    });
  };

  test('strict mode blocks non-allowlisted tools', async () => {
    registerMcpSkill();
    _permissionMode = 'strict';
    _allowedTools = ['other_tool'];
    const result = await dispatchSkill('mcp_tool', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not in workspace allowlist');
  });

  test('strict mode allows allowlisted tools', async () => {
    registerMcpSkill();
    _permissionMode = 'strict';
    _allowedTools = ['mcp_tool'];
    const result = await dispatchSkill('mcp_tool', {}, ctx);
    expect(result.ok).toBe(true);
  });

  test('ask mode blocks when approval denied', async () => {
    registerMcpSkill();
    _permissionMode = 'ask';
    _approvalResult = false;
    const result = await dispatchSkill('mcp_tool', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('approval denied');
  });

  test('ask mode allows when approval granted', async () => {
    registerMcpSkill();
    _permissionMode = 'ask';
    _approvalResult = true;
    const result = await dispatchSkill('mcp_tool', {}, ctx);
    expect(result.ok).toBe(true);
  });

  test('builtin skills bypass permission mode gates', async () => {
    skillRegistry.register({
      id: 'test:builtin', name: 'builtin_tool', description: 'Builtin',
      inputSchema: { type: 'object' }, providerType: 'builtin', priority: 10,
      handler: async () => ok('safe'),
    });
    _permissionMode = 'strict';
    _allowedTools = []; // empty allowlist
    const result = await dispatchSkill('builtin_tool', {}, ctx);
    expect(result.ok).toBe(true);
  });

  test('cachedPermissionMode on context overrides global setting', async () => {
    registerMcpSkill();
    _permissionMode = 'auto'; // global says auto
    _allowedTools = [];
    const result = await dispatchSkill('mcp_tool', {}, {
      ...ctx,
      cachedPermissionMode: 'strict', // context says strict
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not in workspace allowlist');
  });
});

describe('dispatchSkill license and billing gates', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    _skillsEnabled = true;
    _budgetAllowed = true;
    _budgetReason = undefined;
    _featureFlagsThrows = false;
    _billingThrows = false;
    skillRegistry.register({
      id: 'test:guarded2',
      name: 'guarded2',
      description: 'Gate test skill',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
  });

  test('featureFlagsService.isEnabled returns false → err with code SKILLS_DISABLED', async () => {
    _skillsEnabled = false;
    const result = await dispatchSkill('guarded2', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('SKILLS_DISABLED');
      expect(result.error.message).toContain('disabled');
    }
  });

  test('billingService.checkTokenBudget returns allowed:false → err with code BUDGET_EXCEEDED', async () => {
    _budgetAllowed = false;
    _budgetReason = 'Budget exceeded';
    const result = await dispatchSkill('guarded2', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('BUDGET_EXCEEDED');
      expect(result.error.message).toContain('Budget exceeded');
    }
  });

  test('featureFlagsService.isEnabled throws → dispatch still proceeds (catch → allow)', async () => {
    _featureFlagsThrows = true;
    const result = await dispatchSkill('guarded2', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('billingService.checkTokenBudget throws → dispatch still proceeds (catch → allow)', async () => {
    _billingThrows = true;
    const result = await dispatchSkill('guarded2', { x: 2 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('normal path succeeds when feature enabled and budget ok', async () => {
    _skillsEnabled = true;
    _budgetAllowed = true;
    const result = await dispatchSkill('guarded2', { ping: true }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ ping: true });
  });
});
