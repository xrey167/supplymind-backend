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

mock.module('../../../infra/observability/otel', () => ({
  withSpan: async (_name: string, _attrs: unknown, fn: (span: any) => unknown) =>
    fn({ setAttribute: () => {} }),
}));

mock.module('../../../infra/observability/sentry', () => ({
  captureException: () => {},
}));

mock.module('../../../events/bus', () => ({
  eventBus: { publish: () => {} },
}));

mock.module('../../../events/topics', () => ({
  Topics: new Proxy({} as Record<string, string>, { get: (_t, prop) => String(prop) }),
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
import { ok } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

const ctx: DispatchContext = {
  callerId: 'test-user',
  workspaceId: 'ws-gates',
  callerRole: 'admin' as const,
};

describe('dispatchSkill — license and billing gates (real production code)', () => {
  // Store originals so they can be restored after the suite if needed
  const _origIsEnabled = featureFlagsService.isEnabled;
  const _origCheckTokenBudget = billingService.checkTokenBudget;

  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();

    // Default: both gates permissive
    featureFlagsService.isEnabled = async () => true;
    billingService.checkTokenBudget = async () => ({ allowed: true });

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
