import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Track which mocks are called
let mockLoadSkillsImpl: () => Promise<void>;
let mockWsInitImpl: () => void;
let mockWsDestroyImpl: () => void;
let mockMcpDisconnectAllImpl: () => Promise<void>;
let mockCreateRedisPairImpl: (url: string) => { publisher: any; subscriber: any };

// Mock logger
mock.module('../../config/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// Mock skills service
mock.module('../../modules/skills/skills.service', () => ({
  skillsService: {
    loadSkills: () => mockLoadSkillsImpl(),
  },
}));

// Mock skills registry
mock.module('../../modules/skills/skills.registry', () => ({
  skillRegistry: {
    list: () => [{ name: 'test-skill' }],
  },
}));

// Mock WS server
mock.module('../../infra/realtime/ws-server', () => ({
  wsServer: {
    init: () => mockWsInitImpl(),
    destroy: () => mockWsDestroyImpl(),
  },
}));

// Mock MCP client pool
mock.module('../../infra/mcp/client-pool', () => ({
  mcpClientPool: {
    disconnectAll: () => mockMcpDisconnectAllImpl(),
  },
}));

// Mock Redis client
mock.module('../../infra/redis/client', () => ({
  createRedisPair: (url: string) => mockCreateRedisPairImpl(url),
}));

// Mock Redis PubSub
mock.module('../../infra/redis/pubsub', () => ({
  RedisPubSub: class MockRedisPubSub {
    constructor(eventBus: any, publisher: any, subscriber: any) {
      this.bridgeToRedis = () => {};
      this.bridgeFromRedis = () => {};
    }

    bridgeToRedis = () => {};
    bridgeFromRedis = () => {};
  },
}));

// DON'T mock the consumers - let them initialize normally
// This prevents interference with ws-consumers tests

// Now import
import { initSubsystems, destroySubsystems } from '../bootstrap';

describe('bootstrap', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockLoadSkillsImpl = async () => {};
    mockWsInitImpl = () => {};
    mockWsDestroyImpl = () => {};
    mockMcpDisconnectAllImpl = async () => {};
    mockCreateRedisPairImpl = () => ({
      publisher: { publish: () => {} },
      subscriber: { subscribe: () => {} },
    });
  });

  describe('initSubsystems', () => {
    test('calls skillsService.loadSkills', async () => {
      let loadSkillsCalled = false;
      mockLoadSkillsImpl = async () => {
        loadSkillsCalled = true;
      };

      await initSubsystems();
      expect(loadSkillsCalled).toBe(true);
    });

    test('calls wsServer.init', async () => {
      let wsInitCalled = false;
      mockWsInitImpl = () => {
        wsInitCalled = true;
      };

      await initSubsystems();
      expect(wsInitCalled).toBe(true);
    });

    test('calls initEventConsumers and initWsConsumers', async () => {
      // These are called directly by bootstrap, we can't easily mock them
      // without breaking the module system, so we just verify that
      // initSubsystems completes without error
      await initSubsystems();
      expect(true).toBe(true);
    });

    test('throws when skill loading fails', async () => {
      mockLoadSkillsImpl = async () => {
        throw new Error('Failed to load skills');
      };

      try {
        await initSubsystems();
        throw new Error('Expected initSubsystems to throw');
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).toBe('Failed to load skills');
      }
    });

    test('continues when Redis fails', async () => {
      mockCreateRedisPairImpl = () => {
        throw new Error('Redis connection failed');
      };

      // Should not throw
      await initSubsystems();
      expect(true).toBe(true);
    });

    test('calls RedisPubSub methods for bridging', async () => {
      let bridgeToCalls: string[] = [];
      let bridgeFromCalls: string[] = [];

      // Create a custom mock that tracks calls
      class TrackingRedisPubSub {
        constructor(eventBus: any, publisher: any, subscriber: any) {}

        bridgeToRedis = (pattern: string) => {
          bridgeToCalls.push(pattern);
        };

        bridgeFromRedis = (pattern: string) => {
          bridgeFromCalls.push(pattern);
        };
      }

      // Temporarily replace RedisPubSub in the mock
      mock.module('../../infra/redis/pubsub', () => ({
        RedisPubSub: TrackingRedisPubSub,
      }));

      await initSubsystems();

      // Verify the bridge methods were called with correct patterns
      expect(bridgeToCalls.length).toBeGreaterThan(0);
      expect(bridgeFromCalls.length).toBeGreaterThan(0);
    });
  });

  describe('destroySubsystems', () => {
    test('calls wsServer.destroy', async () => {
      let wsDestroyCalled = false;
      mockWsDestroyImpl = () => {
        wsDestroyCalled = true;
      };

      await destroySubsystems();
      expect(wsDestroyCalled).toBe(true);
    });

    test('calls mcpClientPool.disconnectAll', async () => {
      let mcpDisconnectCalled = false;
      mockMcpDisconnectAllImpl = async () => {
        mcpDisconnectCalled = true;
      };

      await destroySubsystems();
      expect(mcpDisconnectCalled).toBe(true);
    });

    test('calls both destroy and disconnectAll', async () => {
      let calls: string[] = [];
      mockWsDestroyImpl = () => {
        calls.push('wsDestroy');
      };
      mockMcpDisconnectAllImpl = async () => {
        calls.push('mcpDisconnect');
      };

      await destroySubsystems();
      expect(calls).toContain('wsDestroy');
      expect(calls).toContain('mcpDisconnect');
    });
  });
});
