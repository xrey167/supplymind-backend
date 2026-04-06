import type { Result } from '../../core/result';

export type AgentMode = "raw" | "agent-sdk";
export type AIProvider = "anthropic" | "openai" | "google";

export type ImageContentBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string | ImageContentBlock[]; isError?: boolean }
  | ImageContentBlock;

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  toolCallId?: string;
}

/** Anthropic built-in beta tool types for Computer Use */
export type BetaToolType =
  | 'computer_20251124'
  | 'bash_20250124'
  | 'text_editor_20250728';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
  cacheControl?: { type: 'ephemeral' };
  eagerInputStreaming?: boolean;
  deferLoading?: boolean;
  /** When set, this is a built-in Anthropic beta tool — overrides custom-tool format */
  betaType?: BetaToolType;
  /** Required when betaType is 'computer_20251124' */
  displayWidth?: number;
  displayHeight?: number;
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
  thinkingBudget?: number;
  disableParallelToolUse?: boolean;
  signal?: AbortSignal;
}

export interface RunResult {
  content: string;
  toolCalls?: ToolCallRequest[];
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "pause_turn";
}

export type StreamEvent =
  | { type: "text_delta"; data: { text: string } }
  | { type: "thinking_delta"; data: { thinking: string } }
  | { type: "tool_call_start"; data: { id: string; name: string } }
  | { type: "tool_call_delta"; data: { delta: string } }
  | { type: "tool_call_end"; data: { id: string; name: string; args: unknown } }
  | { type: "done"; data: { usage?: { inputTokens: number; outputTokens: number }; stopReason?: string } }
  | { type: "error"; data: { error: string } };

export interface AgentRuntime {
  run(input: RunInput): Promise<Result<RunResult>>;
  stream(input: RunInput): AsyncIterable<StreamEvent>;
}
