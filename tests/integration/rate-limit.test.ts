import { describe, test, expect } from 'bun:test';
import { PLUGIN_RATE_LIMITS, pluginRateLimit } from '../../src/api/middlewares/rate-limit';

describe('PLUGIN_RATE_LIMITS', () => {
  test('default config has sensible values', () => {
    expect(PLUGIN_RATE_LIMITS.default.max).toBeGreaterThanOrEqual(100);
    expect(PLUGIN_RATE_LIMITS.default.windowMs).toBeGreaterThanOrEqual(60_000);
  });

  test('erp-bc rate limit is lower than or equal to default', () => {
    expect(PLUGIN_RATE_LIMITS['erp-bc'].max).toBeLessThanOrEqual(
      PLUGIN_RATE_LIMITS.default.max,
    );
  });

  test('pluginRateLimit falls back to default for unknown plugins', () => {
    const config = pluginRateLimit('nonexistent-plugin');
    expect(config).toBe(PLUGIN_RATE_LIMITS.default);
  });
});
