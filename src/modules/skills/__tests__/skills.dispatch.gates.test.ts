/**
 * Gate tests for dispatchSkill — runs in an isolated bun process (see CI config).
 *
 * These tests mock featureFlagsService and billingService at the module level so
 * that the REAL dispatchSkill production code is exercised, not an inline
 * reimplementation. Infrastructure that would hit the network or DB is stubbed
 * using the minimum set of mock.module calls to avoid contaminating other test
 * files in the same bun worker.
 *
 * Strategy: mock.module for otel/events (no shared mutable state), then import
 * the real featureFlagsService and billingService singletons and monkey-patch
 * their methods per-test. Because dispatchSkill holds a live reference to those
 * singleton objects, replacing a method on the object is immediately visible to
 * the production code under test.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal infrastructure stubs — only modules with no shared mutable state
// that would break other test files in the same worker.
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

// spread real Topics so downstream tests that import events/topics get the real
// string values (e.g. Topics.WEBHOOK_RECEIVED === 'webhook.received') not 'WEBHOOK_RECEIVED'
const _realTopics = require('../../../events/topics');
mock.module('../../../events/topics', () => ({
  ..._realTopics,
}));

// ---------------------------------------------------------------------------
// Import the real singletons after mock registration.
// The repo/cache layers are NOT mocked here; instead the service methods
// themselves are replaced on the live singleton objects so dispatchSkill
// (which already holds references to those objects) calls our stubs.
// ---------------------------------------------------------------------------

import { dispatchSkill } from '../skills.dispatch';
import { skillRegistry } from '../skills.registry';
import { skillCache } from '../skills.cache';
import { featureFlagsService } from '../../feature-flags/feature-flags.service';
import { billingService } from '../../billing/billing.service';
import { membersRepo } from '../../members/members.repo';
import { ok } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

const ctx: DispatchContext = {
  callerId: 'test-user',
  workspaceId: 'ws-gates',
  callerRole: 'admin' as const,
};

// Member record shape returned by membersRepo
const fakeMember = {
  id: 'mem-1',
  workspaceId: 'ws-gates',
  userId: 'test-user',
  role: 'member' as const,
  invitedBy: null,
  joinedAt: new Date(),
};

describe('dispatchSkill — license and billing gates (real production code)', () => {
  // Store originals so they can be restored after the suite if needed
  const _origIsEnabled = featureFlagsService.isEnabled;
  const _origCheckTokenBudget = billingService.checkTokenBudget;
  const _origFindMember = membersRepo.findMember;

  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();

    // Default: all gates permissive
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    membersRepo.findMember = async () => fakeMember;

    skillRegistry.register({
      id: 'test:gated',
      name: 'gated',
      description: 'Gate test skill',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
  });

  test('featureFlagsService.isEnabled returns false → err with code SKILLS_DISABLED', async () => {
    featureFlagsService.isEnabled = async () => false;
    const result = await dispatchSkill('gated', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('SKILLS_DISABLED');
      expect(result.error.message).toContain('disabled');
    }
  });

  test('billingService.checkTokenBudget returns allowed:false → err with code BUDGET_EXCEEDED', async () => {
    billingService.checkTokenBudget = async () => ({ allowed: false, reason: 'Budget exceeded' });
    const result = await dispatchSkill('gated', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('BUDGET_EXCEEDED');
      expect(result.error.message).toContain('Budget exceeded');
    }
  });

  test('featureFlagsService.isEnabled throws → dispatch still proceeds (catch → allow)', async () => {
    featureFlagsService.isEnabled = async () => { throw new Error('flags service error'); };
    const result = await dispatchSkill('gated', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('billingService.checkTokenBudget throws → dispatch still proceeds (catch → allow)', async () => {
    billingService.checkTokenBudget = async () => { throw new Error('billing service error'); };
    const result = await dispatchSkill('gated', { x: 2 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('normal path succeeds when feature enabled and budget ok', async () => {
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    const result = await dispatchSkill('gated', { ping: true }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ ping: true });
  });
});

describe('dispatchSkill — Gate 4: workspace membership check', () => {
  const _origFindMember = membersRepo.findMember;

  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();

    // All upstream gates permissive
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });
    // Default: caller is a member
    membersRepo.findMember = async () => fakeMember;

    skillRegistry.register({
      id: 'test:member-gated',
      name: 'member-gated',
      description: 'Membership gate test skill',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
  });

  test('caller is a member → dispatch succeeds', async () => {
    membersRepo.findMember = async () => fakeMember;
    const result = await dispatchSkill('member-gated', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
  });

  test('caller is NOT a member → err with code WORKSPACE_ACCESS_DENIED', async () => {
    membersRepo.findMember = async () => null;
    const result = await dispatchSkill('member-gated', { x: 1 }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('WORKSPACE_ACCESS_DENIED');
      expect(result.error.message).toContain('not a member');
    }
  });

  test('system callers (callerRole === system) bypass membership gate', async () => {
    membersRepo.findMember = async () => null; // Would deny non-system callers
    const systemCtx: DispatchContext = {
      callerId: 'a2a-service',
      workspaceId: 'ws-gates',
      callerRole: 'system',
    };
    const result = await dispatchSkill('member-gated', { x: 2 }, systemCtx);
    // System callers bypass gate 4 — result should succeed (skill handler invoked)
    expect(result.ok).toBe(true);
  });

  test('membership check throws → err with code MEMBERSHIP_CHECK_FAILED', async () => {
    membersRepo.findMember = async () => { throw new Error('DB connection lost'); };
    const result = await dispatchSkill('member-gated', { x: 3 }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('MEMBERSHIP_CHECK_FAILED');
    }
  });

  test('no callerId in context -> err with code CALLER_ID_REQUIRED', async () => {
    membersRepo.findMember = async () => null;
    const ctxNoCallerId: DispatchContext = {
      workspaceId: 'ws-gates',
      callerRole: 'admin' as const,
      // callerId omitted
    };
    const result = await dispatchSkill('member-gated', { x: 4 }, ctxNoCallerId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as any).code).toBe('CALLER_ID_REQUIRED');
    }
  });
});
