import type { AIProvider } from './types';
import { MODEL_LIMITS, DEFAULT_BUDGET } from '../../modules/context/context.types';

export interface ProviderCapabilities {
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsExtendedThinking: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

// Provider+model → capabilities
// Use model prefix matching (claude-opus → claude)
const PROVIDER_CAPABILITIES: Record<string, Partial<ProviderCapabilities>> = {
  // Anthropic defaults
  anthropic: { supportsVision: true, supportsToolUse: true, supportsExtendedThinking: false },
  // Anthropic extended thinking models
  'claude-opus-4-5': { supportsExtendedThinking: true },
  'claude-opus-4-6': { supportsExtendedThinking: true },
  'claude-sonnet-4-5': { supportsExtendedThinking: true },
  'claude-sonnet-4-6': { supportsExtendedThinking: true },
  // OpenAI defaults
  openai: { supportsVision: true, supportsToolUse: true, supportsExtendedThinking: false },
  // Google defaults
  google: { supportsVision: true, supportsToolUse: true, supportsExtendedThinking: false },
};

export function getCapabilities(provider: AIProvider, model: string): ProviderCapabilities {
  const providerDefaults = PROVIDER_CAPABILITIES[provider] ?? {};
  const modelOverrides = PROVIDER_CAPABILITIES[model] ?? {};
  const limits = MODEL_LIMITS[model] ?? {
    contextWindow: DEFAULT_BUDGET.totalLimit,
    responseMax: DEFAULT_BUDGET.responseReserve,
  };

  return {
    supportsVision: true,
    supportsToolUse: true,
    supportsExtendedThinking: false,
    ...providerDefaults,
    ...modelOverrides,
    maxContextTokens: limits.contextWindow,
    maxOutputTokens: limits.responseMax,
  };
}

export function getContextLimit(provider: AIProvider, model: string): number {
  return getCapabilities(provider, model).maxContextTokens;
}

export function supportsToolUse(provider: AIProvider, model: string): boolean {
  return getCapabilities(provider, model).supportsToolUse;
}

export function supportsExtendedThinking(provider: AIProvider, model: string): boolean {
  return getCapabilities(provider, model).supportsExtendedThinking;
}
