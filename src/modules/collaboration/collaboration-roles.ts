/**
 * Supply chain collaboration role — permission layer.
 *
 * Adds a PermissionPipeline layer that enforces domain-specific access rules
 * for supply chain roles. The layer maps role → allowed actions:
 *
 *   procurement_manager  — can approve purchase orders (tools matching 'purchase_order.*')
 *   logistics_coordinator — can dispatch/track shipments (tools matching 'shipment.*')
 *   warehouse_operator   — can record inventory movements (tools matching 'inventory.*')
 *   finance_approver     — can approve budget changes (tools matching 'budget.*' or 'finance.*')
 *
 * Callers not using a supply chain role receive passthrough so that the rest
 * of the pipeline (mode layer, rules layer, etc.) handles them normally.
 *
 * NOTE: No DB migration is needed — roles are checked as plain strings.
 */

import type { PermissionLayer, PermissionContext } from '../../core/permissions/types';
import { permissionPipeline } from '../../core/permissions/permission-pipeline';

/** Tool name prefix patterns that each domain role is authorised to invoke */
const ROLE_ALLOWED_PREFIXES: Record<string, string[]> = {
  procurement_manager: ['purchase_order.', 'supplier.', 'order.'],
  logistics_coordinator: ['shipment.', 'tracking.', 'carrier.'],
  warehouse_operator: ['inventory.', 'stock.', 'warehouse.'],
  finance_approver: ['budget.', 'finance.', 'invoice.', 'payment.'],
};

/** Supply chain role names as a set for O(1) membership check */
const SUPPLY_CHAIN_ROLES = new Set(Object.keys(ROLE_ALLOWED_PREFIXES));

function isSupplyChainRole(role: string): boolean {
  return SUPPLY_CHAIN_ROLES.has(role);
}

/**
 * The permission layer for supply chain domain roles.
 * Exposed for testing.
 */
export const supplyChainRoleLayer: PermissionLayer = {
  name: 'supply-chain-role',

  async check(ctx: PermissionContext) {
    const workspaceRole = (ctx as any).workspaceRole as string | undefined;
    const callerRole = (ctx as any).callerRole as string | undefined;
    const role = workspaceRole ?? callerRole ?? '';

    if (!isSupplyChainRole(role)) {
      // Not a domain-specific role — let the standard pipeline decide
      return { behavior: 'passthrough' };
    }

    const allowedPrefixes = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const toolName = ctx.toolName ?? '';

    const allowed = allowedPrefixes.some((prefix) => toolName.startsWith(prefix));
    if (allowed) {
      return { behavior: 'allow', reason: `${role} is authorised to invoke ${toolName}` };
    }

    // Domain role present but tool not in allowed set — deny
    return {
      behavior: 'deny',
      reason: `Role '${role}' is not authorised to invoke '${toolName}'`,
    };
  },
};

/**
 * Register the supply chain role layer into the global permission pipeline.
 * Safe to call multiple times — checks if the layer is already registered.
 */
export function registerSupplyChainRoleLayer(): void {
  // Avoid double-registration (idempotent)
  permissionPipeline.removeLayer('supply-chain-role');
  permissionPipeline.addLayer(supplyChainRoleLayer);
}
