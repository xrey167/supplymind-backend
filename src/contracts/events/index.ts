import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const workspaceId = z.string().uuid();
const isoTimestamp = z.string().datetime({ offset: true }).optional();

// ---------------------------------------------------------------------------
// Supply chain — Order events
// ---------------------------------------------------------------------------

export const ScOrderCreatedPayload = z.object({
  workspaceId,
  orderId: z.string(),
  supplierId: z.string().optional(),
  totalValue: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  createdAt: isoTimestamp,
});
export type ScOrderCreatedPayload = z.infer<typeof ScOrderCreatedPayload>;

export const ScOrderUpdatedPayload = z.object({
  workspaceId,
  orderId: z.string(),
  changes: z.record(z.unknown()).optional(),
  updatedAt: isoTimestamp,
});
export type ScOrderUpdatedPayload = z.infer<typeof ScOrderUpdatedPayload>;

export const ScOrderCancelledPayload = z.object({
  workspaceId,
  orderId: z.string(),
  reason: z.string().optional(),
  cancelledAt: isoTimestamp,
});
export type ScOrderCancelledPayload = z.infer<typeof ScOrderCancelledPayload>;

// ---------------------------------------------------------------------------
// Supply chain — Shipment events
// ---------------------------------------------------------------------------

export const ScShipmentDispatchedPayload = z.object({
  workspaceId,
  shipmentId: z.string(),
  orderId: z.string().optional(),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
  estimatedDelivery: isoTimestamp,
  dispatchedAt: isoTimestamp,
});
export type ScShipmentDispatchedPayload = z.infer<typeof ScShipmentDispatchedPayload>;

export const ScShipmentDelayedPayload = z.object({
  workspaceId,
  shipmentId: z.string(),
  orderId: z.string().optional(),
  newEstimatedDelivery: isoTimestamp,
  delayReasonCode: z.string().optional(),
  delayedAt: isoTimestamp,
});
export type ScShipmentDelayedPayload = z.infer<typeof ScShipmentDelayedPayload>;

export const ScShipmentDeliveredPayload = z.object({
  workspaceId,
  shipmentId: z.string(),
  orderId: z.string().optional(),
  deliveredAt: isoTimestamp,
  receivedBy: z.string().optional(),
});
export type ScShipmentDeliveredPayload = z.infer<typeof ScShipmentDeliveredPayload>;

// ---------------------------------------------------------------------------
// Supply chain — Alert events
// ---------------------------------------------------------------------------

export const ScAlertLowStockPayload = z.object({
  workspaceId,
  productId: z.string(),
  sku: z.string().optional(),
  currentQuantity: z.number().nonnegative(),
  reorderPoint: z.number().nonnegative(),
  warehouseId: z.string().optional(),
  detectedAt: isoTimestamp,
});
export type ScAlertLowStockPayload = z.infer<typeof ScAlertLowStockPayload>;

export const ScAlertSupplierRiskPayload = z.object({
  workspaceId,
  supplierId: z.string(),
  supplierName: z.string().optional(),
  riskScore: z.number().min(0).max(100).optional(),
  riskFactors: z.array(z.string()).optional(),
  detectedAt: isoTimestamp,
});
export type ScAlertSupplierRiskPayload = z.infer<typeof ScAlertSupplierRiskPayload>;

export const ScAlertPriceChangePayload = z.object({
  workspaceId,
  productId: z.string(),
  supplierId: z.string().optional(),
  previousPrice: z.number().nonnegative(),
  newPrice: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  changePercent: z.number().optional(),
  detectedAt: isoTimestamp,
});
export type ScAlertPriceChangePayload = z.infer<typeof ScAlertPriceChangePayload>;

// ---------------------------------------------------------------------------
// Supply chain — Sync lifecycle events
// ---------------------------------------------------------------------------

export const ScSyncCompletedPayload = z.object({
  workspaceId,
  integrationId: z.string().optional(),
  syncJobId: z.string().optional(),
  recordsSynced: z.number().nonnegative().optional(),
  completedAt: isoTimestamp,
});
export type ScSyncCompletedPayload = z.infer<typeof ScSyncCompletedPayload>;

export const ScSyncFailedPayload = z.object({
  workspaceId,
  integrationId: z.string().optional(),
  syncJobId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  failedAt: isoTimestamp,
});
export type ScSyncFailedPayload = z.infer<typeof ScSyncFailedPayload>;
