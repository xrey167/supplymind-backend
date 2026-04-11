import { describe, test, expect } from 'bun:test';
import { getMetrics } from '../../../src/infra/observability/metrics';

describe('getMetrics', () => {
  test('returns meter with expected instruments', () => {
    const m = getMetrics();
    expect(m.taskCounter).toBeDefined();
    expect(m.taskDuration).toBeDefined();
    expect(m.pluginHealthGauge).toBeDefined();
    expect(m.syncRecordCounter).toBeDefined();
    expect(m.intentGateLatency).toBeDefined();
    expect(m.rateLimit).toBeDefined();
  });

  test('returns the same instance on repeated calls (singleton)', () => {
    const m1 = getMetrics();
    const m2 = getMetrics();
    expect(m1).toBe(m2);
  });
});
