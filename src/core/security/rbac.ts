/**
 * Role-Based Access Control (RBAC)
 *
 * Role hierarchy (highest to lowest privilege):
 *   system > admin > operator > agent > viewer
 *
 * - system: internal processes (orchestration engine, event consumers)
 * - admin: workspace owners, API keys with full access
 * - operator: human users with elevated privileges
 * - agent: AI agents executing tools on behalf of users
 * - viewer: read-only access
 */

export const Roles = {
  SYSTEM: 'system',
  ADMIN: 'admin',
  OPERATOR: 'operator',
  AGENT: 'agent',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

/** Role privilege level — higher number = more privilege */
const ROLE_LEVEL: Record<Role, number> = {
  system: 50,
  admin: 40,
  operator: 30,
  agent: 20,
  viewer: 10,
};

/** Check if callerRole has sufficient privilege for requiredRole */
export function hasPermission(callerRole: string, requiredRole: Role): boolean {
  const callerLevel = ROLE_LEVEL[callerRole as Role];
  if (callerLevel === undefined) return false; // unknown role = denied
  const requiredLevel = ROLE_LEVEL[requiredRole];
  return callerLevel >= requiredLevel;
}

/** Validate that a string is a known role */
export function isValidRole(role: string): role is Role {
  return role in ROLE_LEVEL;
}

/** Default required role per skill provider type */
export const PROVIDER_REQUIRED_ROLE: Record<import('../../modules/skills/skills.types').SkillProviderType, Role> = {
  inline: 'admin',      // inline code execution — admin only
  agent: 'operator',    // A2A agent delegation — operator+
  mcp: 'operator',      // external server calls — operator+
  tool: 'agent',        // tool composition/aliasing — agent+
  worker: 'agent',      // queue jobs — agent+
  plugin: 'agent',      // plugin tools — agent+
  builtin: 'viewer',    // safe builtins — anyone
};

/** Get the required role for a skill, using provider default if not explicitly set */
export function getRequiredRole(providerType: string, explicitRole?: string): Role {
  if (explicitRole && isValidRole(explicitRole)) return explicitRole;
  return (PROVIDER_REQUIRED_ROLE as Record<string, Role>)[providerType] ?? 'admin'; // unknown provider = require admin
}

/** Map workspace role to RBAC role at the middleware boundary */
const WORKSPACE_ROLE_MAP: Record<string, Role> = {
  // Core workspace roles
  owner: 'admin',
  admin: 'admin',
  member: 'operator',
  viewer: 'viewer',
  // Supply chain domain roles
  // procurement_manager: can approve purchase orders — operator-level privilege
  procurement_manager: 'operator',
  // logistics_coordinator: can dispatch and track shipments — operator-level privilege
  logistics_coordinator: 'operator',
  // warehouse_operator: records inventory movements via AI agent tools — agent-level privilege
  warehouse_operator: 'agent',
  // finance_approver: approves budget changes — requires admin-level privilege
  finance_approver: 'admin',
};

export function mapWorkspaceRole(workspaceRole: string): Role {
  return WORKSPACE_ROLE_MAP[workspaceRole] ?? 'viewer';
}

/** Check if a workspace role has a known mapping */
export function isKnownWorkspaceRole(role: string): boolean {
  return role in WORKSPACE_ROLE_MAP;
}
