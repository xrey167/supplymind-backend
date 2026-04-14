import { z } from 'zod';

export const SupplyChainAlertPayloadSchema = z.object({
  workspaceId: z.string(),
  alertType: z.enum(['low_stock', 'supplier_risk', 'price_change', 'shipment_delay']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  entityId: z.string(),
  entityType: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type SupplyChainAlertPayload = z.infer<typeof SupplyChainAlertPayloadSchema>;

export const SupplyChainOrderEventPayloadSchema = z.object({
  workspaceId: z.string(),
  orderId: z.string(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type SupplyChainOrderEventPayload = z.infer<typeof SupplyChainOrderEventPayloadSchema>;

export const SupplyChainShipmentEventPayloadSchema = z.object({
  workspaceId: z.string(),
  shipmentId: z.string(),
  orderId: z.string().optional(),
  estimatedDelivery: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type SupplyChainShipmentEventPayload = z.infer<typeof SupplyChainShipmentEventPayloadSchema>;

export const SupplyChainInventoryEventPayloadSchema = z.object({
  workspaceId: z.string(),
  itemId: z.string(),
  currentStock: z.number().int().nonnegative(),
  threshold: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type SupplyChainInventoryEventPayload = z.infer<typeof SupplyChainInventoryEventPayloadSchema>;

export const SupplyChainSyncEventPayloadSchema = z.object({
  workspaceId: z.string(),
  installationId: z.string(),
  recordsSynced: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type SupplyChainSyncEventPayload = z.infer<typeof SupplyChainSyncEventPayloadSchema>;
