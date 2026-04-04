import type { DomainEvent, DomainEventStrategy, StrategyContext, ForecastAccuracyDropPayload } from '../types';

// TODO: Make thresholds configurable per workspace
const ACCURACY_DROP_THRESHOLD = 15; // percentage points
const MIN_ACCEPTABLE_ACCURACY = 70; // percent

export interface ForecastData {
  forecastId: string;
  materialId: string;
  accuracy: number;
  previousAccuracy: number;
  horizon: string; // e.g., '7d', '30d', '90d'
  // TODO: Add segment-level accuracy (by region, product category, etc.)
  // TODO: Add bias direction (over-forecasting vs under-forecasting)
  // TODO: Add confidence interval data
}

export const forecastStrategy: DomainEventStrategy<ForecastData> = {
  entityType: 'forecast',

  evaluate(data: ForecastData, context: StrategyContext): DomainEvent[] {
    const events: DomainEvent[] = [];

    // TODO: Implement accuracy drop detection
    // - Check if accuracy dropped by >= ACCURACY_DROP_THRESHOLD from previous
    // - Check if accuracy fell below MIN_ACCEPTABLE_ACCURACY
    // - Severity: critical if below 50%, warning if below 70%
    // - Emit 'domain:forecast:accuracy_drop' with ForecastAccuracyDropPayload

    // TODO: Implement demand shift detection
    // - Detect sustained directional bias in forecast errors
    // - Emit 'domain:forecast:demand_shift'

    return events;
  },
};
