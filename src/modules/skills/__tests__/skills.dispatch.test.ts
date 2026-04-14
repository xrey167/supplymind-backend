import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Infrastructure stubs — mock.module for modules with no shared mutable state
// that would break other files in the same bun worker. Must precede imports.
// ---------------------------------------------------------------------------

const _realOtel = require('../../../infra/observability/otel');
mock.module('../../../infra/observability/otel', () => ({
  ..._realOtel,
  withSpan: async (_name: string, _attrs: unknown, fn: (span: any) => unknown) =>
    fn({ setAttribute: () => {} }),
}));

const _realSentry = require('../../../infra/observability/sentry');
mock.module('../../../infra/observability/sentry', () => ({
  ..._realSentry,
  captureException: () => {},
}));

const _realBus = require('../../../events/bus');
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: { publish: () => {} },
}));

const _realTopics = require('../../../events/topics');
mock.module('../../../events/topics', () => ({
  ..._realTopics,
}));

const _realToolApprovals = require('../../../infra/state/tool-approvals');
mock.module('../../../infra/state/tool-approvals', () => ({
  ..._realToolApprovals,
  createApprovalRequest: createApprovalRequestStub,
}));

// Stub for createApprovalRequest — mutable so tests can override
function createApprovalRequestStub(
  _approvalId: string,
  _workspaceId: string,
  _timeoutMs: number,
): Promise<{ approved: boolean; updatedInput?: unknown }> {
  return Promise.resolve({ approved: _approvalResultRef.value });
}

// Mutable ref shared between stub and tests
const _approvalResultRef = { value: true };

// ---------------------------------------------------------------------------
// Imports — the REAL dispatchSkill and its singleton dependencies
// ---------------------------------------------------------------------------

import { dispatchSkill } from '../skills.dispatch';
import { skillRegistry } from '../skills.registry';
import { skillCache } from '../skills.cache';
import { hooksRegistry } from '../../tools/tools.hooks';
import { workspaceSettingsService } from '../../settings/workspace-settings/workspace-settings.service';
import { featureFlagsService } from '../../feature-flags/feature-flags.service';
import { billingService } from '../../billing/billing.service';
import { ok, err } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const ctx: DispatchContext = {
  callerId: 'test-user',
  workspaceId: 'ws-1',
  callerRole: 'admin' as const,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registerBuiltin(name: string, handler?: (args: any) => Promise<any>) {
  skillRegistry.register({
    id: `test:${name}`,
    name,
    description: name,
    inputSchema: { type: 'object' },
    providerType: 'builtin',
    priority: 10,
    handler: handler ?? (async (args) => ok(args)),
  });
}

function registerMcp(name: string, handler?: (args: any) => Promise<any>) {
  skillRegistry.register({
    id: `test:${name}`,
    name,
    description: name,
    inputSchema: { type: 'object' },
    providerType: 'mcp',
    priority: 15,
    handler: handler ?? (async () => ok('done')),
  });
}

// ---------------------------------------------------------------------------
// Core dispatch tests
// ---------------------------------------------------------------------------

describe('dispatchSkill', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    // Gates: permissive defaults via singleton monkey-patch
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    workspaceSettingsService.getToolPermissionMode = async () => 'auto' as any;
    workspaceSettingsService.getAllowedToolNames = async () => [];
    workspaceSettingsService.getApprovalTimeoutMs = async () => 5000;
  });

  test('returns error for unknown skill', async () => {
    const result = await dispatchSkill('nope', {}, ctx);
    expect(result.ok).toBe(false);
  });

  test('dispatches to registered skill and returns result', async () => {
    registerBuiltin('echo');
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

// ---------------------------------------------------------------------------
// Hook tests
// ---------------------------------------------------------------------------

describe('dispatchSkill hooks', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    hooksRegistry.clear();
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    workspaceSettingsService.getToolPermissionMode = async () => 'auto' as any;
    workspaceSettingsService.getAllowedToolNames = async () => [];
    workspaceSettingsService.getApprovalTimeoutMs = async () => 5000;
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

// ---------------------------------------------------------------------------
// RBAC tests
// ---------------------------------------------------------------------------

describe('dispatchSkill RBAC', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    // Stub permission mode so non-builtin skills don't hit the DB
    workspaceSettingsService.getToolPermissionMode = async () => 'auto' as any;
    workspaceSettingsService.getAllowedToolNames = async () => [];
    workspaceSettingsService.getApprovalTimeoutMs = async () => 5000;
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

// ---------------------------------------------------------------------------
// Permission mode tests
// Use cachedPermissionMode on context to bypass workspaceSettingsService.getToolPermissionMode,
// and monkey-patch workspaceSettingsService for allowlist / timeout queries.
// ---------------------------------------------------------------------------

describe('dispatchSkill permission modes', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    workspaceSettingsService.getAllowedToolNames = async () => [];
    workspaceSettingsService.getApprovalTimeoutMs = async () => 5000;
    _approvalResultRef.value = true;
  });

  test('strict mode blocks non-allowlisted tools', async () => {
    registerMcp('mcp_tool');
    workspaceSettingsService.getAllowedToolNames = async () => ['other_tool'];
    const result = await dispatchSkill('mcp_tool', {}, { ...ctx, cachedPermissionMode: 'strict' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not in workspace allowlist');
  });

  test('strict mode allows allowlisted tools', async () => {
    registerMcp('mcp_tool');
    workspaceSettingsService.getAllowedToolNames = async () => ['mcp_tool'];
    const result = await dispatchSkill('mcp_tool', {}, { ...ctx, cachedPermissionMode: 'strict' });
    expect(result.ok).toBe(true);
  });

  test('ask mode blocks when approval denied', async () => {
    registerMcp('mcp_tool');
    _approvalResultRef.value = false;
    const result = await dispatchSkill('mcp_tool', {}, { ...ctx, cachedPermissionMode: 'ask' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('approval denied');
  });

  test('ask mode allows when approval granted', async () => {
    registerMcp('mcp_tool');
    _approvalResultRef.value = true;
    const result = await dispatchSkill('mcp_tool', {}, { ...ctx, cachedPermissionMode: 'ask' });
    expect(result.ok).toBe(true);
  });

  test('builtin skills bypass permission mode gates', async () => {
    skillRegistry.register({
      id: 'test:builtin', name: 'builtin_tool', description: 'Builtin',
      inputSchema: { type: 'object' }, providerType: 'builtin', priority: 10,
      handler: async () => ok('safe'),
    });
    workspaceSettingsService.getAllowedToolNames = async () => []; // empty allowlist
    const result = await dispatchSkill('builtin_tool', {}, { ...ctx, cachedPermissionMode: 'strict' });
    expect(result.ok).toBe(true);
  });

  test('cachedPermissionMode on context overrides workspaceSettingsService', async () => {
    registerMcp('mcp_tool');
    workspaceSettingsService.getToolPermissionMode = async () => 'auto' as any; // service says auto
    workspaceSettingsService.getAllowedToolNames = async () => [];
    const result = await dispatchSkill('mcp_tool', {}, {
      ...ctx,
      cachedPermissionMode: 'strict', // context says strict
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not in workspace allowlist');
  });
});

// ---------------------------------------------------------------------------
// Gate tests (inline copy matching skills.dispatch.gates.test.ts scenarios)
// ---------------------------------------------------------------------------

describe('dispatchSkill gates', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    registerBuiltin('gated');
  });

  test('isEnabled returns false → SKILLS_DISABLED', async () => {
    featureFlagsService.isEnabled = async () => false;
    const result = await dispatchSkill('gated', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).code).toBe('SKILLS_DISABLED');
  });

  test('checkTokenBudget returns allowed:false → BUDGET_EXCEEDED', async () => {
    billingService.checkTokenBudget = async () => ({ allowed: false, reason: 'Monthly budget exceeded' });
    const result = await dispatchSkill('gated', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).code).toBe('BUDGET_EXCEEDED');
  });

  test('isEnabled throws → dispatch proceeds (fail-open)', async () => {
    featureFlagsService.isEnabled = async () => { throw new Error('DB down'); };
    const result = await dispatchSkill('gated', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('checkTokenBudget throws → dispatch proceeds (fail-open)', async () => {
    billingService.checkTokenBudget = async () => { throw new Error('Billing service unavailable'); };
    const result = await dispatchSkill('gated', { x: 2 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('normal path: both gates pass → ok = true', async () => {
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    const result = await dispatchSkill('gated', { ping: true }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ ping: true });
  });
});
