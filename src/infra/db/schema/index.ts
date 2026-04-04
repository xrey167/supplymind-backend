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
} from 'drizzle-orm/pg-core';

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
