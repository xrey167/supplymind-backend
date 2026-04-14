export type CollaborationStrategy = 'fan_out' | 'consensus' | 'debate' | 'map_reduce';
export type MergeStrategy = 'concat' | 'best_score' | 'majority_vote' | 'custom';

// ---------------------------------------------------------------------------
// Domain-specific collaboration roles — supply chain
// ---------------------------------------------------------------------------

/**
 * Supply chain roles for workspace collaboration.
 * These roles are checked as strings (no DB migration required) and map to
 * standard RBAC privilege levels for permission enforcement.
 *
 * Role → RBAC mapping (see collaboration-roles.ts):
 *   procurement_manager → operator  (can create/approve purchase orders)
 *   logistics_coordinator → operator  (can dispatch/track shipments)
 *   warehouse_operator → agent       (can record inventory movements)
 *   finance_approver → admin         (can approve budget changes)
 */
export type SupplyChainRole =
  | 'procurement_manager'
  | 'logistics_coordinator'
  | 'warehouse_operator'
  | 'finance_approver';

/** All workspace collaboration roles (core + domain-specific) */
export type CollaborationRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'viewer'
  | SupplyChainRole;

export interface CollaborationRequest {
  strategy: CollaborationStrategy;
  query: string;
  agents: string[];
  mergeStrategy?: MergeStrategy;
  maxRounds?: number;
  items?: unknown[];
  timeoutMs?: number;
  judgeAgent?: string;
  convergenceThreshold?: number;
}

export interface AgentResponse {
  agent: string;
  result: string;
  score?: number;
  durationMs: number;
  error?: string;
  round?: number;
}

export interface CollaborationResult {
  id: string;
  strategy: CollaborationStrategy;
  output: string;
  responses: AgentResponse[];
  agreement?: number;
  rounds?: number;
  convergedAt?: number;
  totalDurationMs: number;
  warning?: string;
}

export type CollabDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
) => Promise<string>;

// Domain-specific roles are defined above as SupplyChainRole / CollaborationRole.
