import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { logger } from '../../config/logger';

const tracer = trace.getTracer('supplymind-backend');

let provider: import('@opentelemetry/sdk-trace-base').BasicTracerProvider | null = null;

export function initOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.info('OTel: no OTEL_EXPORTER_OTLP_ENDPOINT — traces disabled');
    return;
  }

  try {
    const { BasicTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'supplymind-backend';
    const resource = new Resource({ [ATTR_SERVICE_NAME]: serviceName });
    const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

    provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    logger.info({ endpoint, serviceName }, 'OTel: tracing initialized');
  } catch (err) {
    logger.warn({ err }, 'OTel: failed to initialize — traces disabled');
  }
}

export async function shutdownOtel(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    provider = null;
  }
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export { tracer, SpanStatusCode };
