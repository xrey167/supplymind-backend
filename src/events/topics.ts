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
  MEMORY_ROLLED_BACK: 'memory.rolled_back',
  // Orchestration
  ORCHESTRATION_STARTED: 'orchestration.started',
  ORCHESTRATION_STEP_COMPLETED: 'orchestration.step.completed',
  ORCHESTRATION_GATE_WAITING: 'orchestration.gate.waiting',
  ORCHESTRATION_COMPLETED: 'orchestration.completed',
  ORCHESTRATION_FAILED: 'orchestration.failed',
  ORCHESTRATION_CANCELLED: 'orchestration.cancelled',
  ORCHESTRATION_GATE_RESOLVED: 'orchestration.gate.resolved',
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
  // Domain Knowledge
  DOMAIN_KNOWLEDGE_SEEDED: 'domain.knowledge.seeded',
  DOMAIN_KNOWLEDGE_UPDATED: 'domain.knowledge.updated',
  DOMAIN_CONTEXT_INJECTED: 'domain.context.injected',
  // Learning & Adaptation
  LEARNING_OBSERVATION_RECORDED: 'learning.observation.recorded',
  LEARNING_PROPOSAL_CREATED: 'learning.proposal.created',
  LEARNING_PROPOSAL_APPLIED: 'learning.proposal.applied',
  LEARNING_PROPOSAL_APPROVED: 'learning.proposal.approved',
  LEARNING_PROPOSAL_REJECTED: 'learning.proposal.rejected',
  ADAPTATION_AGENT_CYCLE_COMPLETED: 'learning.adaptation_agent.cycle_completed',
  SKILL_PERFORMANCE_RECORDED: 'learning.skill.performance_recorded',
  // Collab Intel
  COLLAB_INTEL_BOARD_CREATED:           'collab-intel.board.created',
  COLLAB_INTEL_BOARD_UPDATED:           'collab-intel.board.updated',
  COLLAB_INTEL_BOARD_DELETED:           'collab-intel.board.deleted',
  COLLAB_INTEL_MEMBER_ADDED:            'collab-intel.member.added',
  COLLAB_INTEL_MEMBER_REMOVED:          'collab-intel.member.removed',
  COLLAB_INTEL_MENTION_CREATED:         'collab-intel.mention.created',
  COLLAB_INTEL_PROPOSAL_CREATED:        'collab-intel.proposal.created',
  COLLAB_INTEL_PROPOSAL_CLOSED:         'collab-intel.proposal.closed',
  COLLAB_INTEL_VOTE_CAST:               'collab-intel.vote.cast',
  COLLAB_INTEL_APPROVAL_CHAIN_CREATED:  'collab-intel.approval.chain.created',
  COLLAB_INTEL_APPROVAL_STEP_RESPONDED: 'collab-intel.approval.step.responded',
  COLLAB_INTEL_APPROVAL_CHAIN_RESOLVED: 'collab-intel.approval.chain.resolved',
  // Webhooks
  WEBHOOK_RECEIVED: 'webhook.received',
  // Alert rules
  ALERT_RULE_FIRED: 'alert.rule.fired',
} as const;

export type Topic = typeof Topics[keyof typeof Topics];
