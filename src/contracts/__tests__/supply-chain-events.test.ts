import { describe, it, expect } from 'bun:test';
import {
  SupplyChainAlertPayloadSchema,
  SupplyChainOrderEventPayloadSchema,
  SupplyChainShipmentEventPayloadSchema,
  SupplyChainInventoryEventPayloadSchema,
  SupplyChainSyncEventPayloadSchema,
} from '../supply-chain-events';

describe('SupplyChainAlertPayloadSchema', () => {
  const validPayload = {
    workspaceId: 'ws-123',
    alertType: 'low_stock' as const,
    severity: 'high' as const,
    entityId: 'item-456',
    entityType: 'inventory_item',
    message: 'Stock level critically low',
    timestamp: '2026-04-14T10:00:00.000Z',
  };

  it('parses a valid alert payload', () => {
    const result = SupplyChainAlertPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alertType).toBe('low_stock');
      expect(result.data.severity).toBe('high');
    }
  });

  it('parses all valid alertType values', () => {
    const alertTypes = ['low_stock', 'supplier_risk', 'price_change', 'shipment_delay'] as const;
    for (const alertType of alertTypes) {
      const result = SupplyChainAlertPayloadSchema.safeParse({ ...validPayload, alertType });
      expect(result.success).toBe(true);
    }
  });

  it('parses all valid severity values', () => {
    const severities = ['low', 'medium', 'high', 'critical'] as const;
    for (const severity of severities) {
      const result = SupplyChainAlertPayloadSchema.safeParse({ ...validPayload, severity });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional metadata', () => {
    const result = SupplyChainAlertPayloadSchema.safeParse({
      ...validPayload,
      metadata: { supplierId: 'sup-789', quantity: 5 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata?.supplierId).toBe('sup-789');
    }
  });

  it('rejects invalid alertType', () => {
    const result = SupplyChainAlertPayloadSchema.safeParse({
      ...validPayload,
      alertType: 'unknown_type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = SupplyChainAlertPayloadSchema.safeParse({
      ...validPayload,
      severity: 'urgent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-datetime timestamp', () => {
    const result = SupplyChainAlertPayloadSchema.safeParse({
      ...validPayload,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('SupplyChainOrderEventPayloadSchema', () => {
  it('parses a valid order event payload', () => {
    const result = SupplyChainOrderEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      orderId: 'order-001',
      status: 'confirmed',
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('allows optional status and metadata', () => {
    const result = SupplyChainOrderEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      orderId: 'order-001',
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('SupplyChainShipmentEventPayloadSchema', () => {
  it('parses a valid shipment event payload', () => {
    const result = SupplyChainShipmentEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      shipmentId: 'ship-001',
      orderId: 'order-001',
      estimatedDelivery: '2026-04-20T12:00:00.000Z',
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('SupplyChainInventoryEventPayloadSchema', () => {
  it('parses a valid inventory event payload', () => {
    const result = SupplyChainInventoryEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      itemId: 'item-001',
      currentStock: 3,
      threshold: 10,
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative stock', () => {
    const result = SupplyChainInventoryEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      itemId: 'item-001',
      currentStock: -1,
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('SupplyChainSyncEventPayloadSchema', () => {
  it('parses a valid sync completed payload', () => {
    const result = SupplyChainSyncEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      installationId: 'inst-001',
      recordsSynced: 42,
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid sync failed payload with error', () => {
    const result = SupplyChainSyncEventPayloadSchema.safeParse({
      workspaceId: 'ws-123',
      installationId: 'inst-001',
      error: 'Connection timeout',
      timestamp: '2026-04-14T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
