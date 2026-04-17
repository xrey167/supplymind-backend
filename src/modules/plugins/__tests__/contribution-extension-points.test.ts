import { describe, test, expect, beforeEach } from 'bun:test';
import {
  PluginContributionRegistry,
} from '../plugin-contribution-registry';
import type {
  OAuthProviderContribution,
  RoutingStrategyContribution,
} from '../plugin-contribution-registry';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const fakeProvider: OAuthProviderContribution['provider'] = {
  id: 'test-p',
  displayName: 'Test',
  flowType: 'device_code' as const,
};

const fakeStrategy: RoutingStrategyContribution = {
  name: 'test-plugin:custom',
  select: () => null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OAuthProviderContribution and RoutingStrategyContribution extension points', () => {
  let registry: PluginContributionRegistry;

  beforeEach(() => {
    registry = new PluginContributionRegistry();
  });

  // -------------------------------------------------------------------------
  // getProviderConnectors
  // -------------------------------------------------------------------------

  describe('getProviderConnectors', () => {
    test('should return empty array when no plugins registered provider connectors', () => {
      // Arrange — empty registry (no registrations)

      // Act
      const result = registry.getProviderConnectors();

      // Assert
      expect(result).toEqual([]);
    });

    test('should return empty array when registered plugin has no providerConnectors field', () => {
      // Arrange
      registry.register('plugin-a', { topics: { FOO: 'foo.bar' } });

      // Act
      const result = registry.getProviderConnectors();

      // Assert
      expect(result).toEqual([]);
    });

    test('should include provider connector when plugin registers one', () => {
      // Arrange
      registry.register('plugin-a', {
        providerConnectors: [{ provider: fakeProvider }],
      });

      // Act
      const result = registry.getProviderConnectors();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].provider.id).toBe('test-p');
      expect(result[0].provider.displayName).toBe('Test');
      expect(result[0].provider.flowType).toBe('device_code');
    });

    test('should return connectors from all registered plugins when multiple plugins contribute providers', () => {
      // Arrange
      const providerB: OAuthProviderContribution['provider'] = {
        id: 'provider-b',
        displayName: 'Provider B',
        flowType: 'authorization_code_pkce' as const,
      };

      registry.register('plugin-a', {
        providerConnectors: [{ provider: fakeProvider }],
      });
      registry.register('plugin-b', {
        providerConnectors: [{ provider: providerB }],
      });

      // Act
      const result = registry.getProviderConnectors();

      // Assert
      expect(result).toHaveLength(2);
      const ids = result.map((c) => c.provider.id);
      expect(ids).toContain('test-p');
      expect(ids).toContain('provider-b');
    });
  });

  // -------------------------------------------------------------------------
  // getRoutingStrategies
  // -------------------------------------------------------------------------

  describe('getRoutingStrategies', () => {
    test('should return empty array when no plugins registered routing strategies', () => {
      // Arrange — empty registry

      // Act
      const result = registry.getRoutingStrategies();

      // Assert
      expect(result).toEqual([]);
    });

    test('should return empty array when registered plugin has no routingStrategies field', () => {
      // Arrange
      registry.register('plugin-a', { topics: { FOO: 'foo.bar' } });

      // Act
      const result = registry.getRoutingStrategies();

      // Assert
      expect(result).toEqual([]);
    });

    test('should include routing strategy when plugin registers one', () => {
      // Arrange
      registry.register('plugin-a', {
        routingStrategies: [fakeStrategy],
      });

      // Act
      const result = registry.getRoutingStrategies();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-plugin:custom');
    });

    test('should expose a callable select function on contributed routing strategy', () => {
      // Arrange
      registry.register('plugin-a', {
        routingStrategies: [fakeStrategy],
      });

      // Act
      const result = registry.getRoutingStrategies();
      const strategy = result[0];

      // Assert — function is callable and returns the expected value
      expect(typeof strategy.select).toBe('function');
      expect(strategy.select([], { excluded: new Set(), counter: 0 })).toBeNull();
    });

    test('should concatenate routing strategies from multiple plugins', () => {
      // Arrange
      const strategyB: RoutingStrategyContribution = {
        name: 'plugin-b:alt-strategy',
        select: () => null,
      };

      registry.register('plugin-a', {
        routingStrategies: [fakeStrategy],
      });
      registry.register('plugin-b', {
        routingStrategies: [strategyB],
      });

      // Act
      const result = registry.getRoutingStrategies();

      // Assert
      expect(result).toHaveLength(2);
      const names = result.map((s) => s.name);
      expect(names).toContain('test-plugin:custom');
      expect(names).toContain('plugin-b:alt-strategy');
    });
  });

  // -------------------------------------------------------------------------
  // Cross-concern: new extension points coexist without interference
  // -------------------------------------------------------------------------

  describe('isolation from other contribution types', () => {
    test('should not affect existing contributions when provider connectors and routing strategies are registered alongside them', () => {
      // Arrange
      registry.register('plugin-a', {
        topics: { SC_TEST: 'sc.test' },
        providerConnectors: [{ provider: fakeProvider }],
        routingStrategies: [fakeStrategy],
      });

      // Act & Assert
      expect(registry.getTopics()).toEqual({ SC_TEST: 'sc.test' });
      expect(registry.getProviderConnectors()).toHaveLength(1);
      expect(registry.getRoutingStrategies()).toHaveLength(1);
      // Unrelated types remain empty
      expect(registry.getRoles()).toHaveLength(0);
      expect(registry.getWorkers()).toHaveLength(0);
      expect(registry.getCommands()).toHaveLength(0);
      expect(registry.getHooks()).toHaveLength(0);
    });

    test('should clear provider connectors and routing strategies on clear()', () => {
      // Arrange
      registry.register('plugin-a', {
        providerConnectors: [{ provider: fakeProvider }],
        routingStrategies: [fakeStrategy],
      });

      // Act
      registry.clear();

      // Assert
      expect(registry.getProviderConnectors()).toEqual([]);
      expect(registry.getRoutingStrategies()).toEqual([]);
    });
  });
});
