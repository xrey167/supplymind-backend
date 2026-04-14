import { describe, it, expect } from 'bun:test';
import * as telemetry from '../index';

describe('core/telemetry facade', () => {
  it('exports initOtel as a function', () => {
    expect(typeof telemetry.initOtel).toBe('function');
  });

  it('exports shutdownOtel as a function', () => {
    expect(typeof telemetry.shutdownOtel).toBe('function');
  });

  it('exports withSpan as a function', () => {
    expect(typeof telemetry.withSpan).toBe('function');
  });

  it('exports tracer', () => {
    expect(telemetry.tracer).toBeDefined();
  });

  it('exports SpanStatusCode', () => {
    expect(telemetry.SpanStatusCode).toBeDefined();
  });

  it('re-exports trace-context utilities', () => {
    expect(typeof telemetry.generateTraceId).toBe('function');
    expect(typeof telemetry.withTraceId).toBe('function');
    expect(typeof telemetry.getCurrentTraceId).toBe('function');
    expect(typeof telemetry.requireTraceId).toBe('function');
  });
});
