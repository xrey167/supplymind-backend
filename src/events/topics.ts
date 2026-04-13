export const Topics = {
  // Skills
  SKILL_REGISTERED: 'skill.registered',
  SKILL_INVOKED: 'skill.invoked',
  SKILL_FAILED: 'skill.failed',
  // Tasks
  TASK_CREATED: 'task.created',
  TASK_STATUS: 'task.status',
  TASK_TEXT_DELTA: 'task.text_delta',
  TASK_TOOL_CALL: 'task.tool_call',
  TASK_ARTIFACT: 'task.artifact',
  TASK_ERROR: 'task.error',
  TASK_COMPLETED: 'task.completed',
  TASK_CANCELED: 'task.canceled',
  TASK_UNBLOCKED: 'task.unblocked',
  TASK_ROUND_COMPLETED: 'task.round.completed',
  TASK_THINKING_DELTA: 'task.thinking_delta',
  // Agents
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DELETED: 'agent.deleted',
  AGENT_RUN_STARTED: 'agent.run.started',
  AGENT_RUN_COMPLETED: 'agent.run.completed',
  // MCP
  MCP_CONNECTED: 'mcp.connected',
  MCP_DISCONNECTED: 'mcp.disconnected',
  MCP_TOOLS_DISCOVERED: 'mcp.tools.discovered',
  // Collaboration
  COLLAB_STARTED: 'collaboration.started',
  COLLAB_COMPLETED: 'collaboration.completed',
  // Workflows
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_STEP_COMPLETED: 'workflow.step.completed',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',
  // TODO: Domain events — deferred (build general base first)
  // DOMAIN_ENTITY_CREATED: 'ontology.entity.created',
  // TODO: Supply chain alerts — deferred
  // SC_ALERT_CRITICAL: 'supply-chain.alert.critical',
  // Sessions
  SESSION_CREATED: 'session.created',
  SESSION_PAUSED: 'session.paused',
  SESSION_RESUMED: 'session.resumed',
  SESSION_CLOSED: 'session.closed',
  SESSION_COMPACTED: 'session.compacted',
  // Memory
  MEMORY_SAVED: 'memory.saved',
  MEMORY_PROPOSAL: 'memory.proposal',
  MEMORY_APPROVED: 'memory.approved',
  MEMORY_REJECTED: 'memory.rejected',
  // Orchestration
  ORCHESTRATION_STARTED: 'orchestration.started',
  ORCHESTRATION_STEP_COMPLETED: 'orchestration.step.completed',
  ORCHESTRATION_GATE_WAITING: 'orchestration.gate.waiting',
  ORCHESTRATION_COMPLETED: 'orchestration.completed',
  ORCHESTRATION_FAILED: 'orchestration.failed',
  ORCHESTRATION_CANCELLED: 'orchestration.cancelled',
  // Task input (A2UI mid-execution pause/resume)
  TASK_INPUT_REQUIRED: 'task.input_required',
  TASK_INPUT_RECEIVED: 'task.input_received',
  // Tool approvals
  TOOL_APPROVAL_REQUESTED: 'tool.approval_requested',
  TOOL_APPROVAL_RESOLVED: 'tool.approval_resolved',
  TOOL_APPROVAL_EXPIRED: 'tool.approval_expired',
  // Security audit
  SECURITY_RBAC_DENIED: 'security.rbac.denied',
  SECURITY_PERMISSION_MODE_BLOCKED: 'security.permission_mode.blocked',
  SECURITY_SANDBOX_EXECUTED: 'security.sandbox.executed',
  SECURITY_SANDBOX_FAILED: 'security.sandbox.failed',
  // Computer Use
  COMPUTER_USE_BASH_WARNING: 'computer-use.bash.warning',
  // Coordinator
  COORDINATOR_PHASE_CHANGED: 'coordinator.phase_changed',
  COORDINATOR_PHASE_COMPLETED: 'coordinator.phase_completed',
  // Verification
  VERIFICATION_VERDICT: 'verification.verdict',
  // Billing
  SUBSCRIPTION_CREATED: 'billing.subscription_created',
  SUBSCRIPTION_UPDATED: 'billing.subscription_updated',
  SUBSCRIPTION_CANCELED: 'billing.subscription_canceled',
  INVOICE_PAID: 'billing.invoice_paid',
  // Budget
  BUDGET_WARNING: 'billing.budget_warning',
  BUDGET_EXCEEDED: 'billing.budget_exceeded',
  // Credentials
  CREDENTIAL_CREATED: 'credentials.created',
  CREDENTIAL_DELETED: 'credentials.deleted',
  // Settings
  SETTINGS_UPDATED: 'settings.updated',
  // API Keys
  API_KEY_CREATED: 'security.api_key.created',
  API_KEY_REVOKED: 'security.api_key.revoked',
  API_KEY_DELETED: 'security.api_key.deleted',
  // System
  HEARTBEAT: 'system.heartbeat',
  // Workspace lifecycle
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_DELETING: 'workspace.deleting',
  WORKSPACE_DELETED: 'workspace.deleted',
  // Member lifecycle
  MEMBER_INVITED: 'member.invited',
  MEMBER_JOINED: 'member.joined',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  // Notifications
  NOTIFICATION_CREATED: 'notification.created',
  NOTIFICATION_DELIVERED: 'notification.delivered',
  NOTIFICATION_READ: 'notification.read',
  // User sync
  USER_SYNCED: 'user.synced',
  USER_DELETED: 'user.deleted',
  // Webhooks
  WEBHOOK_RECEIVED: 'webhook.received',
  // Alert rules
  ALERT_RULE_FIRED: 'alert.rule.fired',
} as const;

export type Topic = typeof Topics[keyof typeof Topics];
