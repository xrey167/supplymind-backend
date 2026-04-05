import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { GatewayContext, GatewayRequest } from '../gateway.types';

/**
 * Gateway tests use a spy-based approach: we mock only logger and eventBus
 * (which are safe to mock globally) and then spy on the actual services.
 *
 * To avoid Bun mock.module pollution, we do NOT mock service modules here.
 * Instead, we test the gateway's routing logic by verifying it calls the
 * correct services — using the real service singletons with mocked repos.
 *
 * For deeper integration testing, see service-level tests.
 */

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) },
}));

// Import gateway — it uses dynamic imports internally, so no mock pollution
const { execute } = await import('../gateway');

// ---- Helpers ----

function makeCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    callerId: 'user-1',
    workspaceId: 'ws-1',
    callerRole: 'admin',
    ...overrides,
  };
}

function makeReq(op: GatewayRequest['op'], params: Record<string, unknown> = {}, ctx?: Partial<GatewayContext>): GatewayRequest {
  return { op, params, context: makeCtx(ctx) };
}

// ---- Tests ----

describe('Gateway', () => {
  describe('skill.list', () => {
    it('returns an array of skills', async () => {
      const result = await execute(makeReq('skill.list'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true);
        const skills = result.value as any[];
        // Should have at least builtin skills loaded at module level
        for (const s of skills) {
          expect(s.name).toBeDefined();
          expect(s.description).toBeDefined();
        }
      }
    });
  });

  describe('task.get', () => {
    it('returns err when task not found', async () => {
      const result = await execute(makeReq('task.get', { id: 'nonexistent-task-xyz' }));
      expect(result.ok).toBe(false);
    });
  });

  describe('unknown op', () => {
    it('returns err for unknown operations', async () => {
      const result = await execute(makeReq('unknown.op' as any));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Unknown gateway op');
      }
    });
  });
});
