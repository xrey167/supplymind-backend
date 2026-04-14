/**
 * Unit tests for supply chain domain role permission layer.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { supplyChainRoleLayer, registerSupplyChainRoleLayer } from '../collaboration-roles';
import { permissionPipeline } from '../../../core/permissions/permission-pipeline';
import type { PermissionContext } from '../../../core/permissions/types';

function makeCtx(toolName: string, role: string): PermissionContext {
  return {
    workspaceId: 'ws-test',
    callerId: 'user-1',
    toolName,
    // Supply chain roles arrive as workspaceRole or callerRole
    workspaceRole: role,
    callerRole: role,
  } as any;
}

describe('supplyChainRoleLayer', () => {
  // -------------------------------------------------------------------------
  // Non-domain roles pass through
  // -------------------------------------------------------------------------

  test('standard workspace roles (admin, member, viewer) pass through', async () => {
    for (const role of ['admin', 'member', 'viewer', 'owner']) {
      const result = await supplyChainRoleLayer.check(makeCtx('purchase_order.approve', role));
      expect(result.behavior).toBe('passthrough');
    }
  });

  // -------------------------------------------------------------------------
  // procurement_manager
  // -------------------------------------------------------------------------

  test('procurement_manager can invoke purchase_order.approve', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('purchase_order.approve', 'procurement_manager'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('procurement_manager can invoke order.create', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('order.create', 'procurement_manager'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('procurement_manager is denied budget.approve', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('budget.approve', 'procurement_manager'),
    );
    expect(result.behavior).toBe('deny');
  });

  // -------------------------------------------------------------------------
  // logistics_coordinator
  // -------------------------------------------------------------------------

  test('logistics_coordinator can invoke shipment.dispatch', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('shipment.dispatch', 'logistics_coordinator'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('logistics_coordinator is denied inventory.adjust', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('inventory.adjust', 'logistics_coordinator'),
    );
    expect(result.behavior).toBe('deny');
  });

  // -------------------------------------------------------------------------
  // warehouse_operator
  // -------------------------------------------------------------------------

  test('warehouse_operator can invoke inventory.adjust', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('inventory.adjust', 'warehouse_operator'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('warehouse_operator is denied finance.approve', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('finance.approve', 'warehouse_operator'),
    );
    expect(result.behavior).toBe('deny');
  });

  // -------------------------------------------------------------------------
  // finance_approver
  // -------------------------------------------------------------------------

  test('finance_approver can invoke budget.approve', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('budget.approve', 'finance_approver'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('finance_approver can invoke invoice.pay', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('invoice.pay', 'finance_approver'),
    );
    expect(result.behavior).toBe('allow');
  });

  test('finance_approver is denied shipment.dispatch', async () => {
    const result = await supplyChainRoleLayer.check(
      makeCtx('shipment.dispatch', 'finance_approver'),
    );
    expect(result.behavior).toBe('deny');
  });
});

describe('registerSupplyChainRoleLayer', () => {
  beforeEach(() => {
    // Clean up after each test to avoid global state leakage
    permissionPipeline.removeLayer('supply-chain-role');
  });

  test('adds the layer to the global permission pipeline', () => {
    registerSupplyChainRoleLayer();
    // Check that pipeline now returns allow for a valid combination
    return permissionPipeline.check(makeCtx('shipment.track', 'logistics_coordinator'))
      .then((result) => {
        expect(result.behavior).toBe('allow');
        expect(result.decisionLayer).toBe('supply-chain-role');
      });
  });

  test('is idempotent — calling twice does not double-register', async () => {
    registerSupplyChainRoleLayer();
    registerSupplyChainRoleLayer();
    // If double-registered, the layer would fire twice; result should still be allow not error
    const result = await permissionPipeline.check(makeCtx('budget.review', 'finance_approver'));
    expect(result.behavior).toBe('allow');
  });
});
