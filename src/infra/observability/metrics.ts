import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';

const METER_NAME = 'supplymind.backend';

export interface AppMetrics {
  taskCounter: Counter;
  taskDuration: Histogram;
  pluginHealthGauge: ObservableGauge;
  syncRecordCounter: Counter;
  intentGateLatency: Histogram;
  rateLimit: Counter;
}

let _metrics: AppMetrics | undefined;

export function getMetrics(): AppMetrics {
  if (_metrics) return _metrics;
  const meter = metrics.getMeter(METER_NAME, '1.0.0');

  _metrics = {
    taskCounter: meter.createCounter('task.created', {
      description: 'Number of tasks created',
    }),
    taskDuration: meter.createHistogram('task.duration_ms', {
      description: 'Task execution duration in milliseconds',
      unit: 'ms',
    }),
    pluginHealthGauge: meter.createObservableGauge('plugin.health', {
      description: '1 = healthy, 0 = unhealthy',
    }),
    syncRecordCounter: meter.createCounter('erp.sync_record', {
      description: 'ERP sync records processed',
    }),
    intentGateLatency: meter.createHistogram('intent_gate.latency_ms', {
      description: 'Intent-gate classification latency',
      unit: 'ms',
    }),
    rateLimit: meter.createCounter('rate_limit.rejected', {
      description: 'Requests rejected by rate limiter',
    }),
  };

  return _metrics;
}
