import { describe, it, expect, mock } from 'bun:test';
import type { GatewayRequest } from '../gateway.types';

/**
 * Tests for the `default:` branch of execute() — plugin-contributed gateway ops.
 *
 * We mock `pluginContributionRegistry` before importing the module under test
 * so the dynamic `import(...)` inside the default case resolves to our mock.
 */

// Mock logger to suppress output
mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) },
}));

// Set up mock for plugin-contribution-registry BEFORE importing gateway
const mockGetGatewayOps = mock(() => [] as any[]);

const _realRegistry = require('../../../modules/plugins/plugin-contribution-registry');
mock.module('../../../modules/plugins/plugin-contribution-registry', () => ({
  ..._realRegistry,
  pluginContributionRegistry: { getGatewayOps: mockGetGatewayOps },
}));

// Import execute after the mock is in place
const { execute } = await import('../gateway');

// ---- Helpers ----

function makeReq(op: string, params: Record<string, unknown> = {}): GatewayRequest {
  return {
    op,
    params,
    context: {
      callerId: 'user-1',
      workspaceId: 'ws-1',
      callerRole: 'admin',
    },
  };
}

// ---- Tests ----

describe('Gateway default dispatch (plugin-contributed ops)', () => {
  describe('registered op', () => {
    it('calls the registered handler and returns its result', async () => {
      const mockHandler = mock(() => Promise.resolve({ ok: true as const, value: 'plugin-result' }));
      mockGetGatewayOps.mockImplementation(() => [
        { op: 'plugin.custom.op', handler: mockHandler },
      ]);

      const req = makeReq('plugin.custom.op', { foo: 'bar' });
      const result = await execute(req);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('plugin-result');
      }
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(req);
    });
  });

  describe('unregistered op', () => {
    it('returns err with "Unknown gateway op: ..." when op is not found', async () => {
      mockGetGatewayOps.mockImplementation(() => []);

      const result = await execute(makeReq('unknown.totally.made.up.op'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe('Unknown gateway op: unknown.totally.made.up.op');
      }
    });
  });
});
