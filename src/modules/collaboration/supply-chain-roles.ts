/**
 * Supply chain domain roles and their associated permission definitions.
 *
 * These roles extend the core workspace role set with fine-grained, domain-specific
 * capabilities for supply chain operations. They sit at the 'operator' RBAC level
 * (see src/core/security/rbac.ts) and are stored in the workspace_role DB enum.
 *
 * Permission keys follow the pattern: "<resource>:<action>"
 */

export type SupplyChainRole =
  | 'procurement_manager'
  | 'logistics_coordinator'
  | 'warehouse_operator'
  | 'finance_approver';

export type SupplyChainPermission =
  // Purchase orders
  | 'purchase_orders:create'
  | 'purchase_orders:approve'
  | 'purchase_orders:view'
  // Supplier data
  | 'suppliers:view'
  | 'suppliers:manage'
  // Shipments
  | 'shipments:manage'
  | 'shipments:view'
  // Inventory
  | 'inventory:view'
  | 'inventory:update'
  // Budget / billing
  | 'budget:view'
  | 'budget:approve';

/**
 * Permission map: role → set of permitted actions.
 *
 * Used by the permission pipeline to make access decisions for supply chain
 * resources without requiring a database lookup on every request.
 */
export const SUPPLY_CHAIN_PERMISSIONS: Record<SupplyChainRole, readonly SupplyChainPermission[]> = {
  /**
   * procurement_manager — responsible for the sourcing and ordering lifecycle.
   * Can create and approve purchase orders and has full visibility into supplier data.
   */
  procurement_manager: [
    'purchase_orders:create',
    'purchase_orders:approve',
    'purchase_orders:view',
    'suppliers:view',
    'suppliers:manage',
    'inventory:view',
  ],

  /**
   * logistics_coordinator — responsible for moving goods between locations.
   * Manages shipments end-to-end and reads inventory to plan logistics.
   */
  logistics_coordinator: [
    'shipments:manage',
    'shipments:view',
    'inventory:view',
    'purchase_orders:view',
  ],

  /**
   * warehouse_operator — responsible for physical inventory management.
   * Can update stock counts and view inbound/outbound shipments.
   */
  warehouse_operator: [
    'inventory:view',
    'inventory:update',
    'shipments:view',
  ],

  /**
   * finance_approver — responsible for financial oversight.
   * Approves budget items and has visibility into billing/spend data.
   */
  finance_approver: [
    'budget:view',
    'budget:approve',
    'purchase_orders:view',
  ],
} as const;

/**
 * Check whether a supply chain role has a specific permission.
 *
 * Returns `false` for unknown roles (including non-supply-chain workspace roles
 * such as 'owner', 'member', etc.) — those are handled by the core RBAC system.
 */
export function supplyChainHasPermission(
  role: string,
  permission: SupplyChainPermission,
): boolean {
  const perms = SUPPLY_CHAIN_PERMISSIONS[role as SupplyChainRole];
  if (!perms) return false;
  return (perms as readonly string[]).includes(permission);
}

/** Return true if the given string is a known supply chain role. */
export function isSupplyChainRole(role: string): role is SupplyChainRole {
  return role in SUPPLY_CHAIN_PERMISSIONS;
}
