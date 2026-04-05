import { describe, it, expect } from 'bun:test';

describe('OTel initialization', () => {
  it('no-ops when OTEL_EXPORTER_OTLP_ENDPOINT is not set', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { initOtel, shutdownOtel } = await import('../otel');
    // Should not throw
    initOtel();
    await shutdownOtel();
  });

  it('withSpan still works without initialization', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { withSpan } = await import('../otel');
    const result = await withSpan('test-span', {}, async () => 42);
    expect(result).toBe(42);
  });
});
