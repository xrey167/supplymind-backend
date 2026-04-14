import { describe, test, expect } from 'bun:test';
import {
  ScOrderCreatedPayload,
  ScOrderUpdatedPayload,
  ScOrderCancelledPayload,
  ScShipmentDispatchedPayload,
  ScShipmentDelayedPayload,
  ScShipmentDeliveredPayload,
  ScAlertLowStockPayload,
  ScAlertSupplierRiskPayload,
  ScAlertPriceChangePayload,
  ScSyncCompletedPayload,
  ScSyncFailedPayload,
} from '../events';

const WS_ID = '123e4567-e89b-12d3-a456-426614174000';
const TS = '2026-04-14T12:00:00Z';

describe('Supply chain event payload schemas', () => {
  describe('ScOrderCreatedPayload', () => {
    test('parses valid payload', () => {
      const result = ScOrderCreatedPayload.safeParse({
        workspaceId: WS_ID,
        orderId: 'ord-001',
        supplierId: 'sup-1',
        totalValue: 500,
        currency: 'USD',
        createdAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('parses minimal payload (optional fields absent)', () => {
      const result = ScOrderCreatedPayload.safeParse({ workspaceId: WS_ID, orderId: 'ord-001' });
      expect(result.success).toBe(true);
    });

    test('rejects invalid workspaceId', () => {
      const result = ScOrderCreatedPayload.safeParse({ workspaceId: 'not-a-uuid', orderId: 'ord-001' });
      expect(result.success).toBe(false);
    });

    test('rejects negative totalValue', () => {
      const result = ScOrderCreatedPayload.safeParse({ workspaceId: WS_ID, orderId: 'ord-001', totalValue: -1 });
      expect(result.success).toBe(false);
    });

    test('rejects currency not 3 chars', () => {
      const result = ScOrderCreatedPayload.safeParse({ workspaceId: WS_ID, orderId: 'ord-001', currency: 'USDD' });
      expect(result.success).toBe(false);
    });
  });

  describe('ScOrderUpdatedPayload', () => {
    test('parses valid payload', () => {
      const result = ScOrderUpdatedPayload.safeParse({
        workspaceId: WS_ID,
        orderId: 'ord-001',
        changes: { status: 'confirmed' },
        updatedAt: TS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ScOrderCancelledPayload', () => {
    test('parses valid payload', () => {
      const result = ScOrderCancelledPayload.safeParse({
        workspaceId: WS_ID,
        orderId: 'ord-001',
        reason: 'supplier unavailable',
        cancelledAt: TS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ScShipmentDispatchedPayload', () => {
    test('parses valid payload', () => {
      const result = ScShipmentDispatchedPayload.safeParse({
        workspaceId: WS_ID,
        shipmentId: 'shp-001',
        carrier: 'DHL',
        trackingNumber: 'TRK123',
        dispatchedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('rejects missing shipmentId', () => {
      const result = ScShipmentDispatchedPayload.safeParse({ workspaceId: WS_ID });
      expect(result.success).toBe(false);
    });
  });

  describe('ScShipmentDelayedPayload', () => {
    test('parses valid payload', () => {
      const result = ScShipmentDelayedPayload.safeParse({
        workspaceId: WS_ID,
        shipmentId: 'shp-001',
        delayReasonCode: 'WEATHER',
        delayedAt: TS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ScShipmentDeliveredPayload', () => {
    test('parses valid payload', () => {
      const result = ScShipmentDeliveredPayload.safeParse({
        workspaceId: WS_ID,
        shipmentId: 'shp-001',
        receivedBy: 'John Doe',
        deliveredAt: TS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ScAlertLowStockPayload', () => {
    test('parses valid payload', () => {
      const result = ScAlertLowStockPayload.safeParse({
        workspaceId: WS_ID,
        productId: 'prod-001',
        currentQuantity: 5,
        reorderPoint: 20,
        detectedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('rejects negative currentQuantity', () => {
      const result = ScAlertLowStockPayload.safeParse({
        workspaceId: WS_ID,
        productId: 'prod-001',
        currentQuantity: -1,
        reorderPoint: 20,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ScAlertSupplierRiskPayload', () => {
    test('parses valid payload', () => {
      const result = ScAlertSupplierRiskPayload.safeParse({
        workspaceId: WS_ID,
        supplierId: 'sup-001',
        riskScore: 75,
        riskFactors: ['late_delivery', 'quality_issues'],
        detectedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('rejects riskScore > 100', () => {
      const result = ScAlertSupplierRiskPayload.safeParse({
        workspaceId: WS_ID,
        supplierId: 'sup-001',
        riskScore: 101,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ScAlertPriceChangePayload', () => {
    test('parses valid payload', () => {
      const result = ScAlertPriceChangePayload.safeParse({
        workspaceId: WS_ID,
        productId: 'prod-001',
        previousPrice: 100,
        newPrice: 120,
        currency: 'EUR',
        changePercent: 20,
        detectedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('rejects negative previousPrice', () => {
      const result = ScAlertPriceChangePayload.safeParse({
        workspaceId: WS_ID,
        productId: 'prod-001',
        previousPrice: -10,
        newPrice: 120,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ScSyncCompletedPayload', () => {
    test('parses valid payload', () => {
      const result = ScSyncCompletedPayload.safeParse({
        workspaceId: WS_ID,
        integrationId: 'int-001',
        recordsSynced: 42,
        completedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('rejects negative recordsSynced', () => {
      const result = ScSyncCompletedPayload.safeParse({
        workspaceId: WS_ID,
        recordsSynced: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ScSyncFailedPayload', () => {
    test('parses valid payload', () => {
      const result = ScSyncFailedPayload.safeParse({
        workspaceId: WS_ID,
        errorCode: 'AUTH_FAILED',
        errorMessage: 'Invalid credentials',
        failedAt: TS,
      });
      expect(result.success).toBe(true);
    });

    test('parses minimal payload', () => {
      const result = ScSyncFailedPayload.safeParse({ workspaceId: WS_ID });
      expect(result.success).toBe(true);
    });
  });
});
