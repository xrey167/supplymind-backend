import { describe, it, expect } from 'bun:test';
import {
  SUPPLY_CHAIN_PERMISSIONS,
  supplyChainHasPermission,
  isSupplyChainRole,
  type SupplyChainRole,
  type SupplyChainPermission,
} from '../supply-chain-roles';

describe('SUPPLY_CHAIN_PERMISSIONS', () => {
  describe('procurement_manager', () => {
    const role: SupplyChainRole = 'procurement_manager';

    it('can create purchase orders', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('purchase_orders:create');
    });

    it('can approve purchase orders', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('purchase_orders:approve');
    });

    it('can view supplier data', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('suppliers:view');
    });

    it('can manage supplier data', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('suppliers:manage');
    });

    it('cannot manage shipments (logistics scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('shipments:manage');
    });

    it('cannot approve budget items (finance scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('budget:approve');
    });
  });

  describe('logistics_coordinator', () => {
    const role: SupplyChainRole = 'logistics_coordinator';

    it('can manage shipments', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('shipments:manage');
    });

    it('can view inventory', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('inventory:view');
    });

    it('cannot update inventory counts (warehouse scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('inventory:update');
    });

    it('cannot approve purchase orders (procurement scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('purchase_orders:approve');
    });
  });

  describe('warehouse_operator', () => {
    const role: SupplyChainRole = 'warehouse_operator';

    it('can update inventory counts', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('inventory:update');
    });

    it('can view inventory', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('inventory:view');
    });

    it('can view shipments', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('shipments:view');
    });

    it('cannot manage shipments (logistics scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('shipments:manage');
    });

    it('cannot create purchase orders (procurement scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('purchase_orders:create');
    });
  });

  describe('finance_approver', () => {
    const role: SupplyChainRole = 'finance_approver';

    it('can approve budget items', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('budget:approve');
    });

    it('can view budget data', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('budget:view');
    });

    it('can view purchase orders', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).toContain('purchase_orders:view');
    });

    it('cannot create purchase orders (procurement scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('purchase_orders:create');
    });

    it('cannot manage shipments (logistics scope only)', () => {
      expect(SUPPLY_CHAIN_PERMISSIONS[role]).not.toContain('shipments:manage');
    });
  });
});

describe('supplyChainHasPermission', () => {
  it('returns true for a role that has the permission', () => {
    expect(
      supplyChainHasPermission('procurement_manager', 'purchase_orders:create'),
    ).toBe(true);
  });

  it('returns false for a role that does not have the permission', () => {
    expect(
      supplyChainHasPermission('warehouse_operator', 'budget:approve'),
    ).toBe(false);
  });

  it('returns false for an unknown (non-supply-chain) role string', () => {
    expect(
      supplyChainHasPermission('owner', 'purchase_orders:create' as SupplyChainPermission),
    ).toBe(false);
  });

  it('returns false (and does not throw) for prototype key role strings', () => {
    expect(
      supplyChainHasPermission('toString', 'purchase_orders:create'),
    ).toBe(false);
  });

  it('returns false for an empty string role', () => {
    expect(
      supplyChainHasPermission('', 'inventory:view'),
    ).toBe(false);
  });

  it('procurement_manager can approve purchase orders', () => {
    expect(
      supplyChainHasPermission('procurement_manager', 'purchase_orders:approve'),
    ).toBe(true);
  });

  it('logistics_coordinator can manage shipments', () => {
    expect(
      supplyChainHasPermission('logistics_coordinator', 'shipments:manage'),
    ).toBe(true);
  });

  it('warehouse_operator can update inventory', () => {
    expect(
      supplyChainHasPermission('warehouse_operator', 'inventory:update'),
    ).toBe(true);
  });

  it('finance_approver can approve budget', () => {
    expect(
      supplyChainHasPermission('finance_approver', 'budget:approve'),
    ).toBe(true);
  });
});

describe('isSupplyChainRole', () => {
  it('returns true for all four supply chain roles', () => {
    const scRoles: SupplyChainRole[] = [
      'procurement_manager',
      'logistics_coordinator',
      'warehouse_operator',
      'finance_approver',
    ];
    for (const role of scRoles) {
      expect(isSupplyChainRole(role)).toBe(true);
    }
  });

  it('returns false for core workspace roles', () => {
    expect(isSupplyChainRole('owner')).toBe(false);
    expect(isSupplyChainRole('admin')).toBe(false);
    expect(isSupplyChainRole('member')).toBe(false);
    expect(isSupplyChainRole('viewer')).toBe(false);
  });

  it('returns false for unknown strings', () => {
    expect(isSupplyChainRole('superadmin')).toBe(false);
    expect(isSupplyChainRole('')).toBe(false);
    expect(isSupplyChainRole('toString')).toBe(false);
  });
});
