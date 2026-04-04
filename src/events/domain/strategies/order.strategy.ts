import type { DomainEvent, DomainEventStrategy, StrategyContext, OrderDeliveryDelayPayload, OrderCostOverrunPayload } from '../types';

// TODO: Make thresholds configurable per workspace
const DELAY_DAYS_WARNING = 3;
const DELAY_DAYS_CRITICAL = 7;
const COST_OVERRUN_THRESHOLD_PERCENT = 10;

export interface OrderData {
  orderId: string;
  supplierId: string;
  expectedDeliveryDate: string;
  revisedDeliveryDate?: string;
  budgetedCost: number;
  actualCost?: number;
  // TODO: Add quantity tracking (expected vs received per line item)
  // TODO: Add quality inspection results on receipt
  // TODO: Add partial delivery tracking
}

export const orderStrategy: DomainEventStrategy<OrderData> = {
  entityType: 'order',

  evaluate(data: OrderData, context: StrategyContext): DomainEvent[] {
    const events: DomainEvent[] = [];

    // TODO: Implement delivery delay detection
    // - Compare revisedDeliveryDate vs expectedDeliveryDate
    // - Calculate delayDays
    // - If delayDays >= DELAY_DAYS_CRITICAL → critical
    // - If delayDays >= DELAY_DAYS_WARNING → warning
    // - Emit 'domain:order:delivery_delay' with OrderDeliveryDelayPayload

    // TODO: Implement delivery recovered detection
    // - If previously delayed and now back on track → emit resolved

    // TODO: Implement cost overrun detection
    // - Calculate overrunPercent = (actualCost - budgetedCost) / budgetedCost * 100
    // - If overrunPercent > COST_OVERRUN_THRESHOLD_PERCENT → warning
    // - Emit 'domain:order:cost_overrun' with OrderCostOverrunPayload

    // TODO: Implement quantity mismatch detection
    // - Compare received vs expected per line item
    // - Emit 'domain:order:quantity_mismatch'

    return events;
  },
};
