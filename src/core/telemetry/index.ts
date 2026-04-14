/**
 * Canonical telemetry entry-point for the backend.
 *
 * OTel init/shutdown and span helpers live in infra/observability/otel.ts.
 * Bootstrap (src/app/bootstrap.ts) imports directly from that path.
 * This file re-exports everything so callers can use either path without
 * introducing a double-init risk — there is only ONE provider instance
 * (the module-level `provider` variable in infra/observability/otel.ts).
 *
 * Trace context utilities (async-local-storage based) are kept here as
 * they belong in core and have no infra dependency.
 */

export { initOtel, shutdownOtel, withSpan, tracer, SpanStatusCode } from '../../infra/observability/otel';
export * from './trace-context';
