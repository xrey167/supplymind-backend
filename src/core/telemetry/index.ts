/**
 * Telemetry facade — delegates to infra/observability/otel.
 *
 * Canonical init path: src/app/bootstrap.ts calls infra/observability/otel
 * directly at Step 0 (initOtel) and on shutdown (shutdownOtel).
 * Import this module when you need telemetry utilities without taking a direct
 * dependency on the infra layer. Do NOT call initOtel/shutdownOtel from here —
 * bootstrap owns the lifecycle.
 */
export { initOtel, shutdownOtel, withSpan, tracer, SpanStatusCode } from '../../infra/observability/otel';
export * from './trace-context';
