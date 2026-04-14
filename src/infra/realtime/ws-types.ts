import type { TaskState, ToolCallStatus } from '../a2a/types';
import type { OrchestrationStatus } from '../../modules/orchestration/orchestration.types';
export type { TaskState };

export type ServerMessage =
  | { type: 'task:status'; taskId: string; status: TaskState }
  | { type: 'task:text_delta'; taskId: string; delta: string }
  | { type: 'task:tool_call'; taskId: string; toolCall: { id: string; name: string; args: unknown; status: ToolCallStatus; result?: unknown } }
  | { type: 'task:artifact'; taskId: string; artifact: unknown }
  | { type: 'task:error'; taskId: string; error: string }
  | { type: 'event'; topic: string; data: unknown; timestamp: string }
  | { type: 'mcp:progress'; toolName: string; progress: unknown }
  | { type: 'skill:result'; requestId: string; name: string; ok: boolean; result?: unknown; error?: string; durationMs: number }
  | { type: 'heartbeat' }
  | { type: 'error'; message: string }
  | { type: 'session:input_required'; sessionId: string; prompt: string }
  | { type: 'session:resumed'; sessionId: string }
  | { type: 'memory:proposal'; proposal: { id: string; agentId: string; title: string; content: string; evidence?: string; type: string } }
  | { type: 'orchestration:status'; orchestrationId: string; status: OrchestrationStatus; stepId?: string; error?: string }
  | { type: 'orchestration:gate'; orchestrationId: string; stepId: string; prompt: string }
  | { type: 'orchestration:gate_resolved'; orchestrationId: string; stepId: string; outcome: 'approved' | 'rejected' | 'timeout' }
  | { type: 'task:thinking_delta'; taskId: string; thinking: string }
  | { type: 'task:round_completed'; taskId: string; roundId: string; iterationIndex: number; toolCallCount: number; tokenUsage: { input: number; output: number }; totalTokens: { input: number; output: number } }
  | { type: 'tool:approval_required'; approvalId: string; taskId: string; toolName: string; args: unknown; workspaceId: string };

export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'task:send'; agentId: string; messages: unknown[] }
  | { type: 'task:cancel'; taskId: string }
  | { type: 'task:interrupt'; taskId: string }
  | { type: 'task:input'; taskId: string; input: unknown }
  | { type: 'task:input:approve'; approvalId: string; approved: boolean; updatedInput?: Record<string, unknown> }
  | { type: 'task:input:gate'; orchestrationId: string; stepId: string; approved: boolean }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'a2a:send'; agentUrl: string; skillId: string; args: unknown }
  | { type: 'skill:invoke'; name: string; args?: Record<string, unknown>; requestId?: string }
  | { type: 'ping' }
  | { type: 'session:resume'; sessionId: string; input: unknown }
  | { type: 'memory:approve'; proposalId: string }
  | { type: 'memory:reject'; proposalId: string; reason?: string }
  | { type: 'orchestration:gate:respond'; orchestrationId: string; stepId: string; approved: boolean };

export interface WsClient {
  id: string;
  ws: unknown; // Bun ServerWebSocket
  subscriptions: Set<string>;
  userId?: string;
  /** Workspace IDs this client is authenticated to access. Set after a successful 'auth' message. */
  allowedWorkspaceIds?: Set<string>;
}
