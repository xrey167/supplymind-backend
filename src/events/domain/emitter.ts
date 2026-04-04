import type { DomainEvent, DomainEventStrategy, EntityType, StrategyContext } from './types';
import { supplierStrategy } from './strategies/supplier.strategy';
import { materialStrategy } from './strategies/material.strategy';
import { orderStrategy } from './strategies/order.strategy';
import { logisticsStrategy } from './strategies/logistics.strategy';
import { forecastStrategy } from './strategies/forecast.strategy';

// TODO: Replace with new EventBus once collaboration layer is implemented
// (currently uses EventEmitter3 via eventBus — will switch to wildcard-capable bus)

const strategyMap: Record<EntityType, DomainEventStrategy<any>> = {
  supplier: supplierStrategy,
  material: materialStrategy,
  order: orderStrategy,
  logistics: logisticsStrategy,
  forecast: forecastStrategy,
};

/**
 * Evaluate entity data through its domain event strategy and emit any resulting events.
 *
 * TODO: Wire to eventBus — emit each DomainEvent to its topic
 * TODO: Persist events to audit log / event store
 * TODO: Support batch evaluation (multiple entities at once)
 * TODO: Add dead letter handling for failed event emissions
 * TODO: Add rate limiting to prevent event storms
 * TODO: Integrate with agent auto-triage (critical events → spawn investigation agent)
 */
export function emitDomainEvents(
  entityType: EntityType,
  data: unknown,
  context: StrategyContext,
): DomainEvent[] {
  const strategy = strategyMap[entityType];
  if (!strategy) {
    // TODO: Log warning for unknown entity type
    return [];
  }

  const events = strategy.evaluate(data, context);

  // TODO: Publish each event to eventBus
  // for (const event of events) {
  //   eventBus.emit(event.topic, event);
  // }

  return events;
}

/**
 * Register a custom strategy for a new entity type (plugin extensibility).
 *
 * TODO: Implement — allows plugins/modules to add domain event strategies
 * for custom entity types beyond the built-in supply chain ones.
 */
export function registerStrategy(
  entityType: string,
  strategy: DomainEventStrategy<any>,
): void {
  // TODO: Validate entityType, check for conflicts, register
  (strategyMap as any)[entityType] = strategy;
}
