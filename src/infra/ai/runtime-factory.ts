import type { AgentRuntime, AIProvider, AgentMode } from './types';
import { AnthropicRawRuntime } from './anthropic';
import { OpenAIRawRuntime } from './openai';
import { GoogleRawRuntime } from './google';

export interface RuntimeOptions {
  apiKey?: string;
}

const rawRuntimes: Record<AIProvider, new (apiKey?: string) => AgentRuntime> = {
  anthropic: AnthropicRawRuntime,
  openai: OpenAIRawRuntime,
  google: GoogleRawRuntime,
};

// agent-sdk runtimes will be added in Phase 8
const agentSdkRuntimes: Partial<Record<AIProvider, new (apiKey?: string) => AgentRuntime>> = {};

export function createRuntime(
  provider: AIProvider,
  mode: AgentMode,
  options?: RuntimeOptions,
): AgentRuntime {
  const runtimeMap = mode === 'agent-sdk' ? agentSdkRuntimes : rawRuntimes;
  const RuntimeClass = runtimeMap[provider];
  if (!RuntimeClass) {
    throw new Error(`No ${mode} runtime available for provider: ${provider}`);
  }
  return new RuntimeClass(options?.apiKey);
}

export function registerAgentSdkRuntime(
  provider: AIProvider,
  RuntimeClass: new (apiKey?: string) => AgentRuntime,
): void {
  agentSdkRuntimes[provider] = RuntimeClass;
}
