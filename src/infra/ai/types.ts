import type { Result } from '../../core/result';

export type AgentMode = "raw" | "agent-sdk";
export type AIProvider = "anthropic" | "openai" | "google";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
  cacheControl?: { type: 'ephemeral' };
  eagerInputStreaming?: boolean;
  deferLoading?: boolean;
}

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }
  | { type: 'none' };

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface RunInput {
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  disableParallelToolUse?: boolean;
  signal?: AbortSignal;
}

export interface RunResult {
  content: string;
  toolCalls?: ToolCallRequest[];
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "pause_turn";
}

export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done" | "error";
  data: unknown;
}

export interface AgentRuntime {
  run(input: RunInput): Promise<Result<RunResult>>;
  stream(input: RunInput): AsyncIterable<StreamEvent>;
}
