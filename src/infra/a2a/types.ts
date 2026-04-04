// A2A Protocol types (Google A2A spec)

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications?: boolean;
    toolChoice?: boolean;
    strictToolUse?: boolean;
    parallelToolUse?: boolean;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: AgentSkill[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  tags?: string[];
}

export type TaskState = 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled';

export interface A2ATask {
  id: string;
  status: { state: TaskState; message?: string };
  artifacts?: Artifact[];
  history?: A2AMessage[];
}

export interface Artifact {
  parts: Part[];
  name?: string;
}

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'data'; data: Record<string, unknown> }
  | { kind: 'file'; file: { name: string; mimeType: string; bytes: string } };

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: Part[];
  roundId?: string;  // which iteration of the tool-call loop produced this message
}

// JSON-RPC 2.0
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface TaskSendParams {
  id?: string;
  skillId?: string;
  args?: Record<string, unknown>;
  message?: A2AMessage;
}

export interface TaskGetParams {
  id: string;
}

export interface TaskCancelParams {
  id: string;
}
