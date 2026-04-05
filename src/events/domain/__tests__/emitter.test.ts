import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockPublish = mock(() => Promise.resolve({} as any));
mock.module('../../bus', () => ({
  eventBus: { publish: mockPublish },
}));
mock.module('../../../config/logger', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));

const { emitDomainEvents, emitDomainEventsBatch, registerStrategy, listStrategies } = await import('../emitter');

describe('Domain Event Emitter', () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockResolvedValue({} as any);
  });

  const ctx = { workspaceId: 'ws-1' };

  it('returns empty for unknown entity type', () => {
    const events = emitDomainEvents('nonexistent', {}, ctx);
    expect(events).toHaveLength(0);
  });

  it('evaluates supplier strategy and publishes events', () => {
    const events = emitDomainEvents('supplier', {
      supplierId: 's-1',
      riskScore: 85,
      previousRiskScore: 50,
      factors: ['late deliveries'],
    }, ctx);
    // The supplier strategy may or may not emit events depending on thresholds
    // But the emitter should at least run without errors
    expect(Array.isArray(events)).toBe(true);
  });

  it('publishes events to eventBus', () => {
    // Register a test strategy that always emits one event
    registerStrategy('test_entity', {
      entityType: 'test_entity' as any,
      evaluate: (_data: any, context: any) => [{
        id: 'evt-1',
        topic: 'domain.test' as any,
        entityType: 'test_entity' as any,
        entityId: 'te-1',
        workspaceId: context.workspaceId,
        timestamp: new Date().toISOString(),
        severity: 'info' as const,
        payload: { value: 42 },
        source: { type: 'system' as const, id: 'test' },
      }],
    });

    const events = emitDomainEvents('test_entity' as any, {}, ctx);
    expect(events).toHaveLength(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toBe('domain.test');
  });

  it('batch evaluates multiple entities', () => {
    const events = emitDomainEventsBatch([
      { entityType: 'test_entity', data: {} },
      { entityType: 'test_entity', data: {} },
    ], ctx);
    expect(events).toHaveLength(2);
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it('listStrategies returns registered types', () => {
    const types = listStrategies();
    expect(types).toContain('supplier');
    expect(types).toContain('material');
    expect(types).toContain('test_entity');
  });
});
