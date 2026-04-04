import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('supplymind-backend');

/**
 * Wrap an async operation in an OTel span.
 * Works whether or not Sentry/OTel is initialized (no-ops gracefully).
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

export { tracer, SpanStatusCode };
