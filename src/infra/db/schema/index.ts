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
export const proposalStatusEnum = pgEnum('proposal_status', ['pending', 'approved', 'rejected']);
export const orchestrationStatusEnum = pgEnum('orchestration_status', ['submitted', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member', 'viewer']);

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
}, (t) => [
  uniqueIndex('np_user_workspace_type_idx').on(t.userId, t.workspaceId, t.type),
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
