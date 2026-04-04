import type { Topic } from '../topics';

// --- Entity Types ---

export type EntityType =
  | 'supplier'
  | 'material'
  | 'order'
  | 'logistics'
  | 'forecast';

// --- Base Domain Event ---

export interface DomainEvent<T = unknown> {
  id: string;
  topic: Topic;
  entityType: EntityType;
  entityId: string;
  workspaceId: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  payload: T;
  /** Which agent or user triggered this event */
  source: { type: 'agent' | 'user' | 'system'; id: string };
  /** Previous value for comparison (if applicable) */
  previous?: unknown;
  metadata?: Record<string, unknown>;
}

// --- Per-Entity Payloads ---

// TODO: Add more supplier-specific payloads (compliance violations, contract expiry, etc.)
export interface SupplierRiskPayload {
  supplierId: string;
  riskScore: number;
  previousScore: number;
  factors: string[];
}

export interface SupplierLeadTimePayload {
  supplierId: string;
  materialId: string;
  currentDays: number;
  previousDays: number;
}

// TODO: Add supplier quality payload (defect rate, inspection results, etc.)
// TODO: Add supplier capacity payload (capacity utilization, availability windows, etc.)

export interface MaterialStockoutPayload {
  materialId: string;
  warehouseId: string;
  currentStock: number;
  safetyStock: number;
  daysUntilStockout: number;
}

export interface MaterialPriceSpikePayload {
  materialId: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
}

// TODO: Add material demand surge payload (forecast vs actual, trend data)
// TODO: Add material expiry warning payload (batch, expiry date, quantity at risk)

export interface OrderDeliveryDelayPayload {
  orderId: string;
  supplierId: string;
  expectedDate: string;
  revisedDate: string;
  delayDays: number;
}

export interface OrderCostOverrunPayload {
  orderId: string;
  budgetedCost: number;
  actualCost: number;
  overrunPercent: number;
}

// TODO: Add order quantity mismatch payload (expected vs received, affected lines)

export interface LogisticsRouteDisruptionPayload {
  routeId: string;
  reason: string;
  affectedOrders: string[];
  estimatedResolutionDate?: string;
}

// TODO: Add logistics capacity constraint payload (carrier, lane, utilization)
// TODO: Add logistics customs hold payload (shipment, port, hold reason, docs needed)

export interface ForecastAccuracyDropPayload {
  forecastId: string;
  materialId: string;
  accuracy: number;
  previousAccuracy: number;
  horizon: string;
}

// TODO: Add forecast demand shift payload (segment, direction, magnitude, confidence)

// --- Strategy Interface ---

/**
 * Each entity type implements a DomainEventStrategy to evaluate
 * incoming data and emit relevant domain events.
 *
 * TODO: Strategies should support configurable thresholds per workspace
 * TODO: Strategies should integrate with agent recommendations (auto-triage)
 */
export interface DomainEventStrategy<TData = unknown> {
  entityType: EntityType;
  /** Evaluate data and return zero or more domain events to emit */
  evaluate(data: TData, context: StrategyContext): DomainEvent[];
}

export interface StrategyContext {
  workspaceId: string;
  // TODO: Add workspace-level threshold config
  // TODO: Add historical baseline data for anomaly detection
  // TODO: Add agent context (which agent requested evaluation, if any)
}
