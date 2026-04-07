import { describe, test, expect } from 'bun:test';
import { PLUGIN_RATE_LIMITS, pluginRateLimit } from '../../../src/api/middlewares/rate-limit';

describe('PLUGIN_RATE_LIMITS', () => {
  test('exports a map with default entry', () => {
    expect(PLUGIN_RATE_LIMITS).toBeDefined();
    expect(PLUGIN_RATE_LIMITS.default).toBeDefined();
    expect(PLUGIN_RATE_LIMITS.default.windowMs).toBeGreaterThan(0);
    expect(PLUGIN_RATE_LIMITS.default.max).toBeGreaterThan(0);
  });

  test('erp-bc plugin has its own config', () => {
    expect(PLUGIN_RATE_LIMITS['erp-bc']).toBeDefined();
    expect(PLUGIN_RATE_LIMITS['erp-bc'].max).toBeLessThanOrEqual(PLUGIN_RATE_LIMITS.default.max);
  });

  test('execution-layer has its own config', () => {
    expect(PLUGIN_RATE_LIMITS['execution-layer']).toBeDefined();
  });
});

describe('pluginRateLimit', () => {
  test('returns plugin-specific config when available', () => {
    const config = pluginRateLimit('erp-bc');
    expect(config).toBe(PLUGIN_RATE_LIMITS['erp-bc']);
  });

  test('falls back to default for unknown plugin', () => {
    const config = pluginRateLimit('unknown-plugin');
    expect(config).toBe(PLUGIN_RATE_LIMITS.default);
  });
});
