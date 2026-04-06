import type { DomainEvent, DomainEventStrategy, EntityType, StrategyContext } from './supply-chain-types';
import { supplierStrategy } from './strategies/supplier.strategy';
import { materialStrategy } from './strategies/material.strategy';
import { orderStrategy } from './strategies/order.strategy';
import { logisticsStrategy } from './strategies/logistics.strategy';
import { forecastStrategy } from './strategies/forecast.strategy';
import { eventBus } from '../bus';
import { logger } from '../../config/logger';

const strategyMap: Record<string, DomainEventStrategy<any>> = {
  supplier: supplierStrategy,
  material: materialStrategy,
  order: orderStrategy,
  logistics: logisticsStrategy,
  forecast: forecastStrategy,
};

/**
 * Evaluate entity data through its domain event strategy and publish resulting events.
 *
 * Each event is published to the EventBus on its topic. Errors are logged but don't
 * propagate — domain event emission is non-blocking by design.
 */
export function emitDomainEvents(
  entityType: EntityType | string,
  data: unknown,
  context: StrategyContext,
): DomainEvent[] {
  const strategy = strategyMap[entityType];
  if (!strategy) {
    logger.warn({ entityType }, 'No domain event strategy registered for entity type');
    return [];
  }

  const events = strategy.evaluate(data, context);

  // Publish each event to EventBus (fire-and-forget)
  for (const event of events) {
    eventBus.publish(event.topic, event).catch((err) => {
      logger.error({ eventId: event.id, topic: event.topic, error: err }, 'Failed to publish domain event');
    });
  }

  if (events.length > 0) {
    logger.debug({ entityType, eventCount: events.length, workspaceId: context.workspaceId }, 'Domain events emitted');
  }

  return events;
}

/**
 * Batch evaluate multiple entities and emit their domain events.
 */
export function emitDomainEventsBatch(
  items: Array<{ entityType: EntityType | string; data: unknown }>,
  context: StrategyContext,
): DomainEvent[] {
  const all: DomainEvent[] = [];
  for (const item of items) {
    all.push(...emitDomainEvents(item.entityType, item.data, context));
  }
  return all;
}

/**
 * Register a custom strategy for a new entity type (plugin extensibility).
 *
 * Customers call this to add domain event strategies for custom entity types
 * beyond the built-in supply chain ones.
 */
export function registerStrategy(
  entityType: string,
  strategy: DomainEventStrategy<any>,
): void {
  if (strategyMap[entityType]) {
    logger.warn({ entityType }, 'Overwriting existing domain event strategy');
  }
  strategyMap[entityType] = strategy;
}

/** List all registered entity types (for admin/debug). */
export function listStrategies(): string[] {
  return Object.keys(strategyMap);
}
