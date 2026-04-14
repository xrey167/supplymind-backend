import { describe, test, expect } from 'bun:test';
import { supplyChainRoleLayer, SUPPLY_CHAIN_ROLE_ENTRIES } from '../roles';
import type { PermissionContext } from '../../../core/permissions/types';

function ctx(role: string, toolName: string): PermissionContext {
  return { workspaceRole: role, toolName } as any;
}

describe('supplyChainRoleLayer', () => {
  test('has name supply-chain-role', () => {
    expect(supplyChainRoleLayer.name).toBe('supply-chain-role');
  });

  describe('passthrough for non-SC roles', () => {
    test('unknown role → passthrough', async () => {
      const result = await supplyChainRoleLayer.check(ctx('unknown_role', 'some.tool'));
      expect(result.behavior).toBe('passthrough');
    });

    test('admin role → passthrough (handled by core RBAC)', async () => {
      const result = await supplyChainRoleLayer.check(ctx('admin', 'purchase_order.approve'));
      expect(result.behavior).toBe('passthrough');
    });

    test('empty role → passthrough', async () => {
      const result = await supplyChainRoleLayer.check({ toolName: 'order.create' } as any);
      expect(result.behavior).toBe('passthrough');
    });
  });

  describe('procurement_manager', () => {
    test('allows purchase_order.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('procurement_manager', 'purchase_order.approve'));
      expect(result.behavior).toBe('allow');
    });

    test('allows supplier.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('procurement_manager', 'supplier.list'));
      expect(result.behavior).toBe('allow');
    });

    test('allows order.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('procurement_manager', 'order.create'));
      expect(result.behavior).toBe('allow');
    });

    test('denies shipment.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('procurement_manager', 'shipment.dispatch'));
      expect(result.behavior).toBe('deny');
    });

    test('denies inventory.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('procurement_manager', 'inventory.update'));
      expect(result.behavior).toBe('deny');
    });
  });

  describe('logistics_coordinator', () => {
    test('allows shipment.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('logistics_coordinator', 'shipment.dispatch'));
      expect(result.behavior).toBe('allow');
    });

    test('allows tracking.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('logistics_coordinator', 'tracking.update'));
      expect(result.behavior).toBe('allow');
    });

    test('allows carrier.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('logistics_coordinator', 'carrier.assign'));
      expect(result.behavior).toBe('allow');
    });

    test('denies purchase_order.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('logistics_coordinator', 'purchase_order.approve'));
      expect(result.behavior).toBe('deny');
    });
  });

  describe('warehouse_operator', () => {
    test('allows inventory.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('warehouse_operator', 'inventory.record'));
      expect(result.behavior).toBe('allow');
    });

    test('allows stock.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('warehouse_operator', 'stock.check'));
      expect(result.behavior).toBe('allow');
    });

    test('allows warehouse.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('warehouse_operator', 'warehouse.scan'));
      expect(result.behavior).toBe('allow');
    });

    test('denies finance.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('warehouse_operator', 'finance.approve'));
      expect(result.behavior).toBe('deny');
    });
  });

  describe('finance_approver', () => {
    test('allows budget.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('finance_approver', 'budget.approve'));
      expect(result.behavior).toBe('allow');
    });

    test('allows finance.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('finance_approver', 'finance.report'));
      expect(result.behavior).toBe('allow');
    });

    test('allows invoice.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('finance_approver', 'invoice.create'));
      expect(result.behavior).toBe('allow');
    });

    test('allows payment.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('finance_approver', 'payment.release'));
      expect(result.behavior).toBe('allow');
    });

    test('denies inventory.* tools', async () => {
      const result = await supplyChainRoleLayer.check(ctx('finance_approver', 'inventory.update'));
      expect(result.behavior).toBe('deny');
    });
  });

  describe('callerRole fallback', () => {
    test('uses callerRole when workspaceRole is absent', async () => {
      const result = await supplyChainRoleLayer.check({ callerRole: 'procurement_manager', toolName: 'purchase_order.approve' } as any);
      expect(result.behavior).toBe('allow');
    });
  });
});

describe('SUPPLY_CHAIN_ROLE_ENTRIES', () => {
  test('has 4 entries', () => {
    expect(SUPPLY_CHAIN_ROLE_ENTRIES).toHaveLength(4);
  });

  const roleNames = ['procurement_manager', 'logistics_coordinator', 'warehouse_operator', 'finance_approver'];
  test.each(roleNames)('%s is present', (role) => {
    expect(SUPPLY_CHAIN_ROLE_ENTRIES.some(r => r.role === role)).toBe(true);
  });

  test('all entries have non-empty allowedToolPrefixes', () => {
    for (const entry of SUPPLY_CHAIN_ROLE_ENTRIES) {
      expect(entry.allowedToolPrefixes.length).toBeGreaterThan(0);
    }
  });
});
