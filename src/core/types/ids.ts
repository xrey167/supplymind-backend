/** Branded primitive: prevents mixing ID types at compile time */
type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type TaskId      = Brand<string, 'TaskId'>;
export type AgentId     = Brand<string, 'AgentId'>;
export type SessionId   = Brand<string, 'SessionId'>;
export type UserId      = Brand<string, 'UserId'>;
export type MemberId    = Brand<string, 'MemberId'>;
export type SkillId     = Brand<string, 'SkillId'>;
export type JobId       = Brand<string, 'JobId'>;
export type McpServerId = Brand<string, 'McpServerId'>;
export type TraceId     = Brand<string, 'TraceId'>;

const PREFIXES: Record<string, string> = {
  WorkspaceId: 'ws_',
  TaskId:      'task_',
  AgentId:     'agent_',
  SessionId:   'sess_',
  UserId:      'usr_',
  MemberId:    'mem_',
  SkillId:     'skill_',
  JobId:       'job_',
  McpServerId: 'mcp_',
};

function makeId<T extends Brand<string, string>>(brand: string, value: string): T {
  const prefix = PREFIXES[brand];
  if (prefix && !value.startsWith(prefix)) {
    throw new Error(`Invalid ${brand}: expected prefix "${prefix}", got "${value}"`);
  }
  return value as T;
}

/** Validated constructors — enforce prefix conventions */
export const workspaceId = (v: string): WorkspaceId => makeId('WorkspaceId', v);
export const taskId      = (v: string): TaskId      => makeId('TaskId', v);
export const agentId     = (v: string): AgentId     => makeId('AgentId', v);
export const sessionId   = (v: string): SessionId   => makeId('SessionId', v);
export const userId      = (v: string): UserId      => makeId('UserId', v);
export const memberId    = (v: string): MemberId    => makeId('MemberId', v);
export const skillId     = (v: string): SkillId     => makeId('SkillId', v);
export const jobId       = (v: string): JobId       => makeId('JobId', v);
export const mcpServerId = (v: string): McpServerId => makeId('McpServerId', v);
export const traceId     = (v: string): TraceId     => v as TraceId;

/**
 * fromDb variants — brand without prefix validation.
 * Use when reading raw UUIDs from Postgres (the DB doesn't store our prefixes).
 */
export const fromDbWorkspaceId = (v: string): WorkspaceId => v as WorkspaceId;
export const fromDbTaskId      = (v: string): TaskId      => v as TaskId;
export const fromDbAgentId     = (v: string): AgentId     => v as AgentId;
export const fromDbSessionId   = (v: string): SessionId   => v as SessionId;
export const fromDbUserId      = (v: string): UserId      => v as UserId;
export const fromDbMemberId    = (v: string): MemberId    => v as MemberId;
export const fromDbSkillId     = (v: string): SkillId     => v as SkillId;
export const fromDbJobId       = (v: string): JobId       => v as JobId;
export const fromDbMcpServerId = (v: string): McpServerId => v as McpServerId;
