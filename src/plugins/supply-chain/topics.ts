/**
 * Supply chain event topic constants.
 *
 * These are contributed to the global Topics object at app startup via the
 * supply-chain plugin manifest (contributions.topics). Do NOT import Topics
 * from events/topics.ts here — that would create a circular dependency via
 * core/hooks. Reference these constants directly from this file.
 */

export const SupplyChainTopics = {
  // Orders
  SC_ORDER_CREATED:  'supply_chain.order.created',
  SC_ORDER_UPDATED:  'supply_chain.order.updated',
  SC_ORDER_CANCELLED: 'supply_chain.order.cancelled',
  // Shipments
  SC_SHIPMENT_DISPATCHED: 'supply_chain.shipment.dispatched',
  SC_SHIPMENT_DELAYED:    'supply_chain.shipment.delayed',
  SC_SHIPMENT_DELIVERED:  'supply_chain.shipment.delivered',
  // Alerts
  SC_ALERT_LOW_STOCK:      'supply_chain.alert.low_stock',
  SC_ALERT_SUPPLIER_RISK:  'supply_chain.alert.supplier_risk',
  SC_ALERT_PRICE_CHANGE:   'supply_chain.alert.price_change',
  // Sync lifecycle
  SC_SYNC_COMPLETED: 'supply_chain.sync.completed',
  SC_SYNC_FAILED:    'supply_chain.sync.failed',
} as const;

export type SupplyChainTopic = (typeof SupplyChainTopics)[keyof typeof SupplyChainTopics];
