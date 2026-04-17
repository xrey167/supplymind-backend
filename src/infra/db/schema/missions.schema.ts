import { pgTable, pgEnum, uuid, text, jsonb, boolean, integer, timestamp, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const agentCategoryEnum = pgEnum('agent_category', [
  'executor', 'planner', 'researcher', 'reviewer', 'visual', 'ops', 'deep', 'quick'
]);

export const permissionModeEnum = pgEnum('mission_permission_mode', [
  'auto', 'ask', 'strict'
]);

export const missionModeEnum = pgEnum('mission_mode', [
  'assist', 'interview', 'advisor', 'team', 'autopilot', 'discipline'
]);

export const missionStatusEnum = pgEnum('mission_status', [
  'pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'rejected'
]);

export const missionWorkerStatusEnum = pgEnum('mission_worker_status', [
  'pending', 'running', 'completed', 'failed', 'skipped'
]);

export const missionArtifactKindEnum = pgEnum('mission_artifact_kind', [
  'plan', 'summary', 'review', 'verification', 'diff', 'table', 'json', 'approval', 'question', 'metrics'
]);

export const missionTemplateStatusEnum = pgEnum('mission_template_status', [
  'draft', 'active', 'archived'
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const agentProfiles = pgTable('agent_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  category: agentCategoryEnum('category').notNull(),
  provider: text('provider'),
  model: text('model'),
  systemPrompt: text('system_prompt'),
  temperature: integer('temperature'),
  maxTokens: integer('max_tokens'),
  permissionMode: permissionModeEnum('permission_mode').default('ask'),
  isDefault: boolean('is_default').default(false),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ap_workspace_category_idx').on(t.workspaceId, t.category),
  index('ap_workspace_default_idx').on(t.workspaceId, t.isDefault),
]);

export const missions = pgTable('missions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  mode: missionModeEnum('mode').notNull(),
  goalPath: jsonb('goal_path').default({}),
  budgetCents: integer('budget_cents'),
  status: missionTemplateStatusEnum('status').notNull().default('draft'),
  config: jsonb('config').default({}),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('m_workspace_status_idx').on(t.workspaceId, t.status),
]);

export const missionRuns = pgTable('mission_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  mode: missionModeEnum('mode').notNull(),
  status: missionStatusEnum('status').notNull().default('pending'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output'),
  metadata: jsonb('metadata').default({}),
  disciplineMaxRetries: integer('discipline_max_retries').default(3),
  budgetCents: integer('budget_cents'),
  spentCents: integer('spent_cents').notNull().default(0),
  costBreakdown: jsonb('cost_breakdown').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('mr_workspace_status_idx').on(t.workspaceId, t.status),
  index('mr_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

export const missionWorkers = pgTable('mission_workers', {
  id: uuid('id').primaryKey().defaultRandom(),
  missionRunId: uuid('mission_run_id').notNull().references(() => missionRuns.id, { onDelete: 'cascade' }),
  role: agentCategoryEnum('role').notNull(),
  phase: text('phase'),
  status: missionWorkerStatusEnum('status').notNull().default('pending'),
  agentProfileId: uuid('agent_profile_id'),
  taskId: text('task_id'),
  output: jsonb('output'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('mw_mission_run_idx').on(t.missionRunId),
  index('mw_mission_status_idx').on(t.missionRunId, t.status),
]);

export const missionArtifacts = pgTable('mission_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  missionRunId: uuid('mission_run_id').notNull().references(() => missionRuns.id, { onDelete: 'cascade' }),
  workerId: uuid('worker_id').references(() => missionWorkers.id, { onDelete: 'set null' }),
  kind: missionArtifactKindEnum('kind').notNull(),
  title: text('title'),
  content: text('content'),
  contentJson: jsonb('content_json'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ma_mission_run_idx').on(t.missionRunId),
  index('ma_mission_run_created_idx').on(t.missionRunId, t.createdAt),
]);

export const missionEvents = pgTable('mission_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  eventType: text('event_type').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  parentResourceId: uuid('parent_resource_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('me_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('me_resource_idx').on(t.resourceType, t.resourceId),
]);
