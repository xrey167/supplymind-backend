/**
 * Branded ID types for compile-time safety.
 *
 * Prevents accidentally passing a TaskId where an AgentId is expected.
 * Zero runtime cost — these are just strings at runtime, but TypeScript
 * enforces the brand at compile time.
 *
 * Usage:
 *   const taskId = 'abc' as TaskId;
 *   const agentId = 'def' as AgentId;
 *   findTask(agentId); // TS error: AgentId is not assignable to TaskId
 *
 * Customers can create their own branded IDs using the Brand helper:
 *   type OrderId = Brand<string, 'OrderId'>;
 */

declare const __brand: unique symbol;

/** Brand a base type with a unique tag. */
export type Brand<T, Tag extends string> = T & { readonly [__brand]: Tag };

export type TaskId = Brand<string, 'TaskId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type SkillId = Brand<string, 'SkillId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;

/** Cast a plain string to a branded ID. Use at system boundaries (parsing, DB reads). */
export function taskId(id: string): TaskId { return id as TaskId; }
export function agentId(id: string): AgentId { return id as AgentId; }
export function workspaceId(id: string): WorkspaceId { return id as WorkspaceId; }
export function sessionId(id: string): SessionId { return id as SessionId; }
export function skillId(id: string): SkillId { return id as SkillId; }
export function approvalId(id: string): ApprovalId { return id as ApprovalId; }
