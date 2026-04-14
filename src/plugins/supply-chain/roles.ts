/**
 * Supply chain domain roles — permission layer and RBAC contributions.
 *
 * This file is the authoritative definition of SC roles and their permissions.
 * It must only import from src/core/ to avoid circular dependencies.
 *
 * - supplyChainRoleLayer: PermissionPipeline layer injected at app startup
 * - SUPPLY_CHAIN_ROLE_ENTRIES: WorkspaceRoleContribution[] registered into RBAC
 */

import type { PermissionLayer, PermissionContext } from '../../core/permissions/types';
import { permissionPipeline } from '../../core/permissions/permission-pipeline';
import type { WorkspaceRoleContribution } from '../../modules/plugins/plugin-contribution-registry';

// ---------------------------------------------------------------------------
// Role type definitions
// ---------------------------------------------------------------------------

export type SupplyChainRole =
  | 'procurement_manager'
  | 'logistics_coordinator'
  | 'warehouse_operator'
  | 'finance_approver';

/** All workspace collaboration roles (core + supply chain domain) */
export type CollaborationRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'viewer'
  | SupplyChainRole;

// ---------------------------------------------------------------------------
// Tool prefix allowlists
// ---------------------------------------------------------------------------

const ROLE_ALLOWED_PREFIXES: Record<string, string[]> = {
  procurement_manager: ['purchase_order.', 'supplier.', 'order.'],
  logistics_coordinator: ['shipment.', 'tracking.', 'carrier.'],
  warehouse_operator: ['inventory.', 'stock.', 'warehouse.'],
  finance_approver: ['budget.', 'finance.', 'invoice.', 'payment.'],
};

const SUPPLY_CHAIN_ROLES = new Set(Object.keys(ROLE_ALLOWED_PREFIXES));

// ---------------------------------------------------------------------------
// Permission layer
// ---------------------------------------------------------------------------

export const supplyChainRoleLayer: PermissionLayer = {
  name: 'supply-chain-role',

  async check(ctx: PermissionContext) {
    const workspaceRole = (ctx as any).workspaceRole as string | undefined;
    const callerRole = (ctx as any).callerRole as string | undefined;
    const role = workspaceRole ?? callerRole ?? '';

    if (!SUPPLY_CHAIN_ROLES.has(role)) {
      return { behavior: 'passthrough' };
    }

    const allowedPrefixes = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const toolName = ctx.toolName ?? '';

    if (allowedPrefixes.some((prefix) => toolName.startsWith(prefix))) {
      return { behavior: 'allow', reason: `${role} is authorised to invoke ${toolName}` };
    }

    return {
      behavior: 'deny',
      reason: `Role '${role}' is not authorised to invoke '${toolName}'`,
    };
  },
};

// ---------------------------------------------------------------------------
// RBAC role entries
// ---------------------------------------------------------------------------

export const SUPPLY_CHAIN_ROLE_ENTRIES: WorkspaceRoleContribution[] = [
  { role: 'procurement_manager', privilege: 'operator', allowedToolPrefixes: ROLE_ALLOWED_PREFIXES.procurement_manager },
  { role: 'logistics_coordinator', privilege: 'operator', allowedToolPrefixes: ROLE_ALLOWED_PREFIXES.logistics_coordinator },
  { role: 'warehouse_operator', privilege: 'agent', allowedToolPrefixes: ROLE_ALLOWED_PREFIXES.warehouse_operator },
  { role: 'finance_approver', privilege: 'admin', allowedToolPrefixes: ROLE_ALLOWED_PREFIXES.finance_approver },
];

// ---------------------------------------------------------------------------
// Bootstrap helper (used by test setup and legacy callers)
// ---------------------------------------------------------------------------

/**
 * Register the supply chain role layer into the global permission pipeline.
 * At app startup this is handled automatically via contributions.permissionLayers.
 * Exported for test setup and explicit call sites.
 */
export function registerSupplyChainRoleLayer(): void {
  permissionPipeline.removeLayer('supply-chain-role');
  permissionPipeline.addLayer(supplyChainRoleLayer);
}
