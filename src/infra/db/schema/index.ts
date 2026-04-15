import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  real,
  timestamp,
  customType,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType(config) { return `vector(${(config as any)?.dimensions ?? 1536})`; },
  toDriver(value) { return `[${value.join(',')}]`; },
  fromDriver(value) { return JSON.parse(value as string); },
});

// Setting enums
export const toolPermissionModeEnum = pgEnum('tool_permission_mode', ['auto', 'ask', 'strict']);

// Enums
export const aiProviderEnum = pgEnum('ai_provider', ['anthropic', 'openai', 'google']);
export const agentModeEnum = pgEnum('agent_mode', ['raw', 'agent-sdk']);
export const skillProviderTypeEnum = pgEnum('skill_provider_type', ['builtin', 'worker', 'plugin', 'mcp', 'inline', 'agent', 'tool']);
export const mcpTransportEnum = pgEnum('mcp_transport', ['stdio', 'sse', 'streamable-http']);
export const a2aTaskStatusEnum = pgEnum('a2a_task_status', ['submitted', 'working', 'input_required', 'completed', 'failed', 'canceled']);
export const roleEnum = pgEnum('role', ['system', 'admin', 'operator', 'agent', 'viewer']);
export const toolCallStatusEnum = pgEnum('tool_call_status', ['pending', 'in_progress', 'completed', 'failed']);

// Tables
export const agentConfigs = pgTable('agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  provider: aiProviderEnum('provider'),
  mode: agentModeEnum('mode'),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt'),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  toolIds: jsonb('tool_ids').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const skillDefinitions = pgTable('skill_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  providerType: skillProviderTypeEnum('provider_type'),
  priority: integer('priority').default(0),
  inputSchema: jsonb('input_schema').default({}),
  handlerConfig: jsonb('handler_config').default({}),
  enabled: boolean('enabled').default(true),
  mcpConfig: jsonb('mcp_config').default({}),   // SkillMcpConfig — keyed by mcp name
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const mcpServerConfigs = pgTable('mcp_server_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id'),   // nullable — null means global server
  name: text('name').notNull(),
  transport: mcpTransportEnum('transport'),
  url: text('url'),
  command: text('command'),
  args: jsonb('args'),
  env: jsonb('env'),
  headers: jsonb('headers'),
  enabled: boolean('enabled').default(true),
  toolManifestCache: jsonb('tool_manifest_cache'),
  cacheExpiresAt: timestamp('cache_expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const a2aTasks = pgTable('a2a_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => agentConfigs.id),
  sessionId: uuid('session_id').references(() => sessions.id),
  status: a2aTaskStatusEnum('status'),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  artifacts: jsonb('artifacts'),
  history: jsonb('history').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('a2a_tasks_status_idx').on(t.status),
]);

export const taskDependencies = pgTable('task_dependencies', {
  taskId: uuid('task_id').notNull().references(() => a2aTasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId: uuid('depends_on_task_id').notNull().references(() => a2aTasks.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
  index('task_deps_depends_on_idx').on(t.dependsOnTaskId),
]);

export const toolCallLogs = pgTable('tool_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => a2aTasks.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  status: toolCallStatusEnum('status'),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('tcl_task_id_idx').on(t.taskId),
]);

// New enums
export const sessionStatusEnum = pgEnum('session_status', ['created', 'active', 'paused', 'closed', 'expired']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const memoryTypeEnum = pgEnum('memory_type', ['domain', 'feedback', 'pattern', 'reference']);
export const memorySourceEnum = pgEnum('memory_source', ['explicit', 'proposed', 'approved']);
export const proposalStatusEnum = pgEnum('proposal_status', ['pending', 'approved', 'auto_applied', 'rejected', 'rolled_back']);
export const orchestrationStatusEnum = pgEnum('orchestration_status', ['submitted', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export const workspaceRoleEnum = pgEnum('workspace_role', [
  'owner',
  'admin',
  'member',
  'viewer',
  // Supply chain domain roles
  'procurement_manager',
  'logistics_coordinator',
  'warehouse_operator',
  'finance_approver',
]);

// Workspaces
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdBy: text('created_by').notNull(),   // Clerk userId
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => [
  uniqueIndex('workspaces_slug_idx').on(t.slug),
]);

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),          // Clerk userId
  role: workspaceRoleEnum('role').notNull().default('member'),
  invitedBy: text('invited_by'),
  joinedAt: timestamp('joined_at').defaultNow(),
}, (t) => [
  uniqueIndex('wm_workspace_user_idx').on(t.workspaceId, t.userId),
  index('wm_user_idx').on(t.userId),
]);

// Users — thin sync from Clerk
export const users = pgTable('users', {
  id: text('id').primaryKey(),              // Clerk userId (e.g. user_2x7...)
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('users_email_idx').on(t.email),
]);

// Workspace invitations
export const workspaceInvitations = pgTable('workspace_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email'),                     // null for link-only invites
  tokenHash: text('token_hash').notNull(),  // SHA-256 of nanoid token
  type: text('type').notNull(),             // 'email' | 'link'
  role: workspaceRoleEnum('role').notNull().default('member'),
  invitedBy: text('invited_by').notNull(),  // userId
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('wi_token_hash_idx').on(t.tokenHash),
  uniqueIndex('wi_workspace_email_idx').on(t.workspaceId, t.email),
]);

// Sessions
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id').references(() => agentConfigs.id),
  status: sessionStatusEnum('status').notNull().default('created'),
  metadata: jsonb('metadata').default({}),
  tokenCount: integer('token_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  closedAt: timestamp('closed_at'),
});

// Session messages
export const sessionMessages = pgTable('session_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolCalls: jsonb('tool_calls'),
  tokenEstimate: integer('token_estimate'),
  isCompacted: boolean('is_compacted').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('sm_session_compacted_idx').on(t.sessionId, t.isCompacted),
]);

// Agent memories
export const agentMemories = pgTable('agent_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id'),
  type: memoryTypeEnum('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  confidence: real('confidence').default(1.0),
  source: memorySourceEnum('source').notNull(),
  metadata: jsonb('metadata').default({}),
  embedding: vector('embedding', { dimensions: 1536 } as any),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Memory proposals
export const memoryProposals = pgTable('memory_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => agentConfigs.id),
  type: memoryTypeEnum('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  evidence: text('evidence'),
  sessionId: uuid('session_id').references(() => sessions.id),
  status: proposalStatusEnum('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
});

// Orchestrations
export const orchestrations = pgTable('orchestrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').references(() => sessions.id),
  name: text('name'),
  definition: jsonb('definition').notNull(),
  status: orchestrationStatusEnum('status').notNull().default('submitted'),
  stepResults: jsonb('step_results').default({}),
  currentStepId: text('current_step_id'),
  input: jsonb('input').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('orch_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

// Workspace settings (key-value per workspace)
export const workspaceSettings = pgTable('workspace_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('ws_settings_workspace_key_idx').on(t.workspaceId, t.key),
]);

// API keys
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),  // first 12 chars for identification
  role: roleEnum('role').notNull().default('admin'),
  enabled: boolean('enabled').default(true),
  expiresAt: timestamp('expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Workflow templates
export const workflowTemplates = pgTable('workflow_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  definition: jsonb('definition').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('wt_workspace_id_idx').on(t.workspaceId),
]);

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id').references(() => agentConfigs.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => a2aTasks.id, { onDelete: 'set null' }),
  model: text('model').notNull(),
  provider: aiProviderEnum('provider').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('ur_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('ur_agent_idx').on(t.agentId),
  index('ur_task_idx').on(t.taskId),
]);

// Billing
export const billingCustomers = pgTable('billing_customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('bc_workspace_id_idx').on(t.workspaceId),
  uniqueIndex('bc_stripe_customer_id_idx').on(t.stripeCustomerId),
]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull(),
  stripePriceId: text('stripe_price_id').notNull(),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('sub_stripe_subscription_id_idx').on(t.stripeSubscriptionId),
  index('sub_workspace_id_idx').on(t.workspaceId),
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  stripeInvoiceId: text('stripe_invoice_id').notNull(),
  amountDue: integer('amount_due').notNull().default(0),
  amountPaid: integer('amount_paid').notNull().default(0),
  currency: text('currency').notNull().default('usd'),
  status: text('status').notNull(),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  pdfUrl: text('pdf_url'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('inv_stripe_invoice_id_idx').on(t.stripeInvoiceId),
  index('inv_workspace_id_idx').on(t.workspaceId),
]);

// Notifications
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  metadata: jsonb('metadata').default({}),
  channel: text('channel').notNull(), // in_app | email | websocket
  status: text('status').notNull().default('pending'), // pending | delivered | read | failed
  readAt: timestamp('read_at'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptedAt: timestamp('last_attempted_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('notifications_user_workspace_idx').on(t.userId, t.workspaceId),
  index('notifications_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

// Notification preferences
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  channels: jsonb('channels').default(['in_app']),
  muted: boolean('muted').default(false),
  quietHours: jsonb('quiet_hours'),
}, (t) => [
  uniqueIndex('np_user_workspace_type_idx').on(t.userId, t.workspaceId, t.type),
]);

// User settings (key-value per user)
export const userSettings = pgTable('user_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('us_user_key_idx').on(t.userId, t.key),
]);

// Credentials (encrypted API keys for AI providers / MCP servers)
export const credentialProviderEnum = pgEnum('credential_provider', ['anthropic', 'openai', 'google', 'custom', 'slack', 'telegram', 'erp-bc']);

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: credentialProviderEnum('provider').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('credentials_workspace_id_idx').on(t.workspaceId),
]);

// Audit logs (append-only)
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull(), // user | agent | system | api_key
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('audit_logs_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('audit_logs_actor_idx').on(t.actorId),
]);

// Prompts
export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  variables: jsonb('variables').default([]),
  tags: jsonb('tags').default([]),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('prompts_workspace_name_version_idx').on(t.workspaceId, t.name, t.version),
  index('prompts_workspace_id_idx').on(t.workspaceId),
]);

// Registered A2A agents (persistent registry)
export const registeredAgents = pgTable('registered_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  url: text('url').notNull(),
  agentCard: jsonb('agent_card').notNull(),
  apiKeyHash: text('api_key_hash'),
  enabled: boolean('enabled').notNull().default(true),
  lastDiscoveredAt: timestamp('last_discovered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('registered_agents_workspace_url_idx').on(t.workspaceId, t.url),
]);

// Inbox items (unified workspace activity feed)
export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  type: text('type').notNull(), // notification | task_update | system | alert
  title: text('title').notNull(),
  body: text('body'),
  metadata: jsonb('metadata').default({}),
  sourceType: text('source_type'), // task | agent | billing | system
  sourceId: text('source_id'),
  read: boolean('read').notNull().default(false),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('inbox_items_user_workspace_idx').on(t.userId, t.workspaceId),
  index('inbox_items_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

// ── Plugin Platform ──────────────────────────────────────────────────────────

export const pluginKindEnum = pgEnum('plugin_kind', [
  'remote_mcp', 'remote_a2a', 'webhook', 'local_sandboxed',
]);

export const pluginStatusEnum = pgEnum('plugin_status', [
  'installing', 'active', 'disabled', 'failed', 'uninstalling', 'uninstalled',
]);

export const pluginEventTypeEnum = pgEnum('plugin_event_type', [
  'installed', 'enabled', 'disabled', 'config_updated', 'version_pinned',
  'health_checked', 'uninstalled', 'rollback_initiated', 'rollback_completed',
]);

export const pluginCatalog = pgTable('plugin_catalog', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  kind: pluginKindEnum('kind').notNull(),
  capabilities: jsonb('capabilities').notNull().default([]),
  requiredPermissions: jsonb('required_permissions').notNull().default([]),
  manifest: jsonb('manifest').notNull().default({}),
  publisher: text('publisher'),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('pc_name_version_idx').on(t.name, t.version),
]);

export const pluginInstallations = pgTable('plugin_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pluginId: uuid('plugin_id').notNull().references(() => pluginCatalog.id),
  status: pluginStatusEnum('status').notNull().default('installing'),
  pinnedVersion: text('pinned_version'),
  config: jsonb('config').notNull().default({}),
  secretBindingIds: jsonb('secret_binding_ids').notNull().default([]),
  policyBinding: jsonb('policy_binding').notNull().default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('pi_workspace_plugin_idx').on(t.workspaceId, t.pluginId),
  index('pi_workspace_idx').on(t.workspaceId),
]);

export const pluginEvents = pgTable('plugin_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  eventType: pluginEventTypeEnum('event_type').notNull(),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pe_installation_created_idx').on(t.installationId, t.createdAt),
  index('pe_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

export const pluginHealthChecks = pgTable('plugin_health_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  metadata: jsonb('metadata').notNull().default({}),
}, (t) => [
  index('phc_installation_checked_idx').on(t.installationId, t.checkedAt),
]);

// ── Execution Layer ───────────────────────────────────────────────────────────

export const executionPlanStatusEnum = pgEnum('execution_plan_status', [
  'draft', 'pending_approval', 'running', 'completed', 'failed', 'cancelled',
]);

export const executionPlans = pgTable('execution_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name'),
  intent: jsonb('intent'),
  steps: jsonb('steps').notNull().default([]),
  input: jsonb('input').notNull().default({}),
  policy: jsonb('policy').notNull().default({}),
  status: executionPlanStatusEnum('status').notNull().default('draft'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ep_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

export const executionRuns = pgTable('execution_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => executionPlans.id),
  orchestrationId: uuid('orchestration_id').references(() => orchestrations.id),
  workspaceId: uuid('workspace_id').notNull(),
  status: text('status').notNull().default('running'),
  intent: jsonb('intent'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('er_plan_started_idx').on(t.planId, t.startedAt),
]);

// ── ERP Sync Plugin ───────────────────────────────────────────────────────────

export const syncJobs = pgTable('sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id),
  workspaceId: uuid('workspace_id').notNull(),
  entityType: text('entity_type').notNull(),
  filter: jsonb('filter'),
  cursor: text('cursor'),
  batchSize: integer('batch_size').notNull().default(100),
  schedule: text('schedule'),
  status: text('status').notNull().default('idle'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sj_workspace_entity_idx').on(t.workspaceId, t.entityType),
  index('sj_installation_idx').on(t.installationId),
]);

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', ['received', 'processed', 'duplicate', 'failed']);
export const alertConditionOperatorEnum = pgEnum('alert_condition_operator', ['eq', 'neq', 'gt', 'lt', 'contains', 'exists']);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id:          uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  description: text('description'),
  token:       text('token').notNull().unique(),
  secretHash:  text('secret_hash').notNull(),
  active:      boolean('active').notNull().default(true),
  createdBy:   text('created_by').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('webhook_endpoints_workspace_idx').on(t.workspaceId),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:          uuid('id').primaryKey().defaultRandom(),
  endpointId:  uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  deliveryKey: text('delivery_key').notNull(),
  payload:     jsonb('payload').notNull(),
  headers:     jsonb('headers').notNull().default({}),
  status:      webhookDeliveryStatusEnum('status').notNull().default('received'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('webhook_deliveries_dedup_idx').on(t.endpointId, t.deliveryKey),
  index('webhook_deliveries_endpoint_idx').on(t.endpointId),
]);

export const alertRules = pgTable('alert_rules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  workspaceId:     uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name:            text('name').notNull(),
  description:     text('description'),
  eventTopic:      text('event_topic').notNull(),
  conditions:      jsonb('conditions').notNull().default([]),
  notifyUserIds:   jsonb('notify_user_ids').notNull().default([]),
  messageTemplate: text('message_template'),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(300),
  enabled:         boolean('enabled').notNull().default(true),
  createdBy:       text('created_by').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('alert_rules_workspace_idx').on(t.workspaceId),
  index('alert_rules_topic_idx').on(t.eventTopic),
]);

export const alertRuleFires = pgTable('alert_rule_fires', {
  id:          uuid('id').primaryKey().defaultRandom(),
  ruleId:      uuid('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  eventTopic:  text('event_topic').notNull(),
  eventData:   jsonb('event_data'),
  firedAt:     timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('alert_rule_fires_rule_idx').on(t.ruleId),
  index('alert_rule_fires_workspace_fired_idx').on(t.workspaceId, t.firedAt),
]);

export const syncRecords = pgTable('sync_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => syncJobs.id),
  workspaceId: uuid('workspace_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  payloadHash: text('payload_hash'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sr_job_created_idx').on(t.jobId, t.createdAt),
  index('sr_workspace_entity_created_idx').on(t.workspaceId, t.entityType, t.createdAt),
  uniqueIndex('sr_job_entity_action_idx').on(t.jobId, t.entityId, t.action),
]);

// ── AI-Native Learning Layer ──────────────────────────────────────────────────

/**
 * Per-plugin domain knowledge graph.
 * Seeded from PluginManifest.domain on install, continuously refined by
 * the domain extractor as tasks complete.
 */
export const domainKnowledgeGraphs = pgTable('domain_knowledge_graphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  pluginId: text('plugin_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  entityGraph: jsonb('entity_graph').notNull().default([]),
  vocabulary: jsonb('vocabulary').notNull().default([]),
  rules: jsonb('rules').notNull().default([]),
  confidenceScores: jsonb('confidence_scores').notNull().default({}),
  version: integer('version').notNull().default(1),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dkg_plugin_workspace_idx').on(t.pluginId, t.workspaceId),
  index('dkg_workspace_idx').on(t.workspaceId),
]);

/**
 * Raw learning signals captured from the event stream.
 * Consumed by analyzers in the learning engine cycle.
 */
export const learningObservations = pgTable('learning_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pluginId: text('plugin_id'),
  observationType: text('observation_type').notNull(),
  signalStrength: real('signal_strength').notNull().default(1.0),
  payload: jsonb('payload').notNull().default({}),
  sourceTopic: text('source_topic').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('lo_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('lo_workspace_type_idx').on(t.workspaceId, t.observationType),
]);

/**
 * Improvement proposals generated by the learning engine.
 * Mirrors the memory proposal pattern: proposals can be auto-applied
 * (based on trust tier) or queued for human approval.
 */
export const improvementProposals = pgTable('improvement_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pluginId: text('plugin_id'),
  proposalType: text('proposal_type').notNull(),  // skill_weight | routing_rule | memory_threshold | new_skill | prompt_update | workflow_template
  changeType: text('change_type').notNull(),       // behavioral | structural
  description: text('description').notNull(),
  evidence: jsonb('evidence').notNull().default([]),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value'),
  confidence: real('confidence').notNull().default(0.5),
  status: proposalStatusEnum('status').notNull().default('pending'),
  rollbackData: jsonb('rollback_data'),
  autoAppliedAt: timestamp('auto_applied_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ip_workspace_status_idx').on(t.workspaceId, t.status),
  index('ip_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

/**
 * Per-plugin adaptation agents — scoped learning workers spawned on install.
 */
export const adaptationAgents = pgTable('adaptation_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pluginId: text('plugin_id').notNull(),
  status: text('status').notNull().default('active'),  // active | paused | deactivated
  lastCycleAt: timestamp('last_cycle_at', { withTimezone: true }),
  cycleCount: integer('cycle_count').notNull().default(0),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('aa_workspace_plugin_idx').on(t.workspaceId, t.pluginId),
]);

/**
 * Rolling skill performance metrics — 24h windows per skill per workspace.
 */
export const skillPerformanceMetrics = pgTable('skill_performance_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull(),
  pluginId: text('plugin_id'),
  invocationCount: integer('invocation_count').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  avgLatencyMs: real('avg_latency_ms'),
  p95LatencyMs: real('p95_latency_ms'),
  lastFailureReason: text('last_failure_reason'),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
}, (t) => [
  index('spm_workspace_skill_window_idx').on(t.workspaceId, t.skillId, t.windowStart),
]);

// ── Collaborative Intelligence ────────────────────────────────────────────────

export const boardVisibilityEnum = pgEnum('board_visibility', ['public', 'private']);
export const mentionStatusEnum = pgEnum('mention_status', ['pending', 'read', 'dismissed']);
// prefixed to avoid clash with existing proposalStatusEnum (used by memory proposals)
export const collabProposalStatusEnum = pgEnum('collab_proposal_status', ['open', 'closed', 'accepted', 'rejected']);
export const voteTypeEnum = pgEnum('vote_type', ['up', 'down']);
export const approvalStepStatusEnum = pgEnum('approval_step_status', ['pending', 'approved', 'rejected', 'skipped']);
export const approvalChainStatusEnum = pgEnum('approval_chain_status', ['pending', 'approved', 'rejected', 'cancelled']);

export const collabBoards = pgTable('collab_boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  visibility: boardVisibilityEnum('visibility').default('public').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cb_workspace_idx').on(t.workspaceId),
]);

export const collabBoardMembers = pgTable('collab_board_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => collabBoards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('viewer'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('cbm_board_user_idx').on(t.boardId, t.userId),
]);

export const collabMentions = pgTable('collab_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => collabBoards.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull(),
  mentionedByUserId: text('mentioned_by_user_id').notNull(),
  contextText: text('context_text').notNull(),
  status: mentionStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cm_board_mentioned_idx').on(t.boardId, t.mentionedUserId),
]);

export const collabProposals = pgTable('collab_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => collabBoards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: text('created_by').notNull(),
  status: collabProposalStatusEnum('status').default('open').notNull(),
  upVotes: integer('up_votes').default(0).notNull(),
  downVotes: integer('down_votes').default(0).notNull(),
  votingEndsAt: timestamp('voting_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cp_board_idx').on(t.boardId),
]);

export const collabVotes = pgTable('collab_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  proposalId: uuid('proposal_id').notNull().references(() => collabProposals.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  voteType: voteTypeEnum('vote_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('cv_proposal_user_idx').on(t.proposalId, t.userId),
]);

export const collabApprovalChains = pgTable('collab_approval_chains', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => collabBoards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  createdBy: text('created_by').notNull(),
  status: approvalChainStatusEnum('status').notNull().default('pending'),
  currentStep: integer('current_step').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cac_board_idx').on(t.boardId),
]);

export const collabApprovalSteps = pgTable('collab_approval_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  chainId: uuid('chain_id').notNull().references(() => collabApprovalChains.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  approverUserId: text('approver_user_id').notNull(),
  status: approvalStepStatusEnum('status').default('pending').notNull(),
  comment: text('comment'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cas_chain_idx').on(t.chainId, t.stepIndex),
]);

export const collabActivities = pgTable('collab_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id').notNull().references(() => collabBoards.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').notNull(),
  activityType: text('activity_type').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ca_board_created_idx').on(t.boardId, t.createdAt),
]);

// ── Gate Audit Log ────────────────────────────────────────────────────────────

export const gateAuditLog = pgTable('gate_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orchestrationId: text('orchestration_id').notNull(),
  stepId: text('step_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  outcome: text('outcome').notNull().$type<'approved' | 'rejected' | 'timeout'>(), // 'approved' | 'rejected' | 'timeout'
  decidedBy: text('decided_by'),      // userId or 'system'
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
  prompt: text('prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('gate_audit_orch_idx').on(t.orchestrationId),
  index('gate_audit_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

export * from './missions.schema';
