import { AnthropicRawRuntime } from './anthropic';
import { OpenAIRawRuntime } from './openai';
import { GoogleRawRuntime } from './google';
import { AnthropicAgentSdkRuntime } from './anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from './openai-agents';
import type { AgentRuntime, AIProvider, AgentMode } from './types';

export function createRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
  if (mode === 'agent-sdk') {
    if (provider === 'anthropic') return new AnthropicAgentSdkRuntime();
    if (provider === 'openai') return new OpenAIAgentSdkRuntime();
    throw new Error(`No agent-sdk runtime for provider: ${provider}`);
  }
  if (provider === 'anthropic') return new AnthropicRawRuntime();
  if (provider === 'openai') return new OpenAIRawRuntime();
  if (provider === 'google') return new GoogleRawRuntime();
  throw new Error(`No raw runtime for provider: ${provider}`);
}
