export type TaskState = 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled';

export type ServerMessage =
  | { type: 'task:status'; taskId: string; status: TaskState }
  | { type: 'task:text_delta'; taskId: string; delta: string }
  | { type: 'task:tool_call'; taskId: string; toolCall: { id: string; name: string; args: unknown; status: 'pending' | 'in_progress' | 'completed' | 'failed'; result?: unknown } }
  | { type: 'task:artifact'; taskId: string; artifact: unknown }
  | { type: 'task:error'; taskId: string; error: string }
  | { type: 'event'; topic: string; data: unknown; timestamp: string }
  | { type: 'mcp:progress'; toolName: string; progress: unknown }
  | { type: 'heartbeat' }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'task:send'; agentId: string; messages: unknown[] }
  | { type: 'task:cancel'; taskId: string }
  | { type: 'task:input'; taskId: string; input: unknown }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'a2a:send'; agentUrl: string; skillId: string; args: unknown }
  | { type: 'ping' };

export interface WsClient {
  id: string;
  ws: unknown; // Bun ServerWebSocket
  subscriptions: Set<string>;
  userId?: string;
}
