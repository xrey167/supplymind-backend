// Generic domain event contract — extend in any domain module
export * from './types';

// Supply-chain-specific domain event types and strategy infrastructure
export { emitDomainEvents, registerStrategy } from './emitter';
export type {
  DomainEvent as SupplyChainDomainEvent,
  DomainEventStrategy,
  EntityType,
  StrategyContext,
  SupplierRiskPayload,
  SupplierLeadTimePayload,
  MaterialStockoutPayload,
  MaterialPriceSpikePayload,
  OrderDeliveryDelayPayload,
  OrderCostOverrunPayload,
  LogisticsRouteDisruptionPayload,
  ForecastAccuracyDropPayload,
} from './supply-chain-types';
export * from './strategies';
