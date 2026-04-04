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
} from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType(config) { return `vector(${(config as any)?.dimensions ?? 1536})`; },
  toDriver(value) { return `[${value.join(',')}]`; },
  fromDriver(value) { return JSON.parse(value as string); },
});

// Enums
export const aiProviderEnum = pgEnum('ai_provider', ['anthropic', 'openai', 'google']);
export const agentModeEnum = pgEnum('agent_mode', ['raw', 'agent-sdk']);
export const skillProviderTypeEnum = pgEnum('skill_provider_type', ['builtin', 'worker', 'plugin', 'mcp', 'inline']);
export const mcpTransportEnum = pgEnum('mcp_transport', ['stdio', 'sse', 'streamable-http']);
export const a2aTaskStatusEnum = pgEnum('a2a_task_status', ['submitted', 'working', 'input_required', 'completed', 'failed', 'canceled']);
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
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const mcpServerConfigs = pgTable('mcp_server_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
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
  agentId: uuid('agent_id').notNull(),
  status: a2aTaskStatusEnum('status'),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  artifacts: jsonb('artifacts'),
  history: jsonb('history').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const toolCallLogs = pgTable('tool_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull(),
  skillName: text('skill_name').notNull(),
  status: toolCallStatusEnum('status'),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});

// New enums
export const sessionStatusEnum = pgEnum('session_status', ['created', 'active', 'paused', 'closed', 'expired']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const memoryTypeEnum = pgEnum('memory_type', ['domain', 'feedback', 'pattern', 'reference']);
export const memorySourceEnum = pgEnum('memory_source', ['explicit', 'proposed', 'approved']);
export const proposalStatusEnum = pgEnum('proposal_status', ['pending', 'approved', 'rejected']);
export const orchestrationStatusEnum = pgEnum('orchestration_status', ['submitted', 'running', 'paused', 'completed', 'failed']);

// Sessions
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  agentId: uuid('agent_id'),
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
  sessionId: uuid('session_id').notNull(),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolCalls: jsonb('tool_calls'),
  tokenEstimate: integer('token_estimate'),
  isCompacted: boolean('is_compacted').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

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
  agentId: uuid('agent_id').notNull(),
  type: memoryTypeEnum('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  evidence: text('evidence'),
  sessionId: uuid('session_id'),
  status: proposalStatusEnum('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
});

// Orchestrations
export const orchestrations = pgTable('orchestrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id'),
  name: text('name'),
  definition: jsonb('definition').notNull(),
  status: orchestrationStatusEnum('status').notNull().default('submitted'),
  stepResults: jsonb('step_results').default({}),
  currentStepId: text('current_step_id'),
  input: jsonb('input').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});
