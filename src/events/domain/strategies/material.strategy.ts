import type { DomainEvent, DomainEventStrategy, StrategyContext, MaterialStockoutPayload, MaterialPriceSpikePayload } from '../types';

// TODO: Make thresholds configurable per workspace
const PRICE_CHANGE_THRESHOLD_PERCENT = 15;
const STOCKOUT_DAYS_WARNING = 7;
const STOCKOUT_DAYS_CRITICAL = 3;

export interface MaterialData {
  materialId: string;
  warehouseId: string;
  currentStock: number;
  safetyStock: number;
  dailyConsumptionRate: number;
  // TODO: Add price tracking fields (current price, 30-day average, contract price)
  // TODO: Add demand forecast fields (forecasted vs actual, trend direction)
  // TODO: Add expiry tracking fields (batch, expiry date, quantity)
  currentPrice?: number;
  previousPrice?: number;
}

export const materialStrategy: DomainEventStrategy<MaterialData> = {
  entityType: 'material',

  evaluate(data: MaterialData, context: StrategyContext): DomainEvent[] {
    const events: DomainEvent[] = [];

    // TODO: Implement stockout risk detection
    // - Calculate daysUntilStockout = (currentStock - safetyStock) / dailyConsumptionRate
    // - If currentStock < safetyStock → critical stockout risk
    // - If daysUntilStockout < STOCKOUT_DAYS_CRITICAL → critical
    // - If daysUntilStockout < STOCKOUT_DAYS_WARNING → warning
    // - Emit 'domain:material:stockout_risk' with MaterialStockoutPayload

    // TODO: Implement stockout resolved detection
    // - If previously below safety stock and now above → emit resolved

    // TODO: Implement price spike detection
    // - Calculate changePercent between currentPrice and previousPrice
    // - If changePercent > PRICE_CHANGE_THRESHOLD_PERCENT → emit price spike
    // - Emit 'domain:material:price_spike' with MaterialPriceSpikePayload

    // TODO: Implement demand surge detection
    // - Compare actual consumption vs forecasted
    // - If actual > forecast * 1.3 → warning surge
    // - Emit 'domain:material:demand_surge'

    // TODO: Implement expiry warning detection
    // - Check batch expiry dates vs current date
    // - If expiry within 30 days → warning
    // - If expiry within 7 days → critical
    // - Emit 'domain:material:expiry_warning'

    return events;
  },
};
