import type { Message } from '../../infra/ai/types';

export interface TokenBudget {
  totalLimit: number;
  budgetRatio: number;
  systemReserve: number;
  responseReserve: number;
}

export interface ModelLimits {
  [model: string]: { contextWindow: number; responseMax: number };
}

export const MODEL_LIMITS: ModelLimits = {
  // Claude 3.x (legacy)
  'claude-sonnet-4-20250514': { contextWindow: 200_000, responseMax: 8_192 },
  'claude-haiku-4-5-20251001': { contextWindow: 200_000, responseMax: 8_192 },
  // Claude 4.x
  'claude-opus-4-5': { contextWindow: 200_000, responseMax: 32_768 },
  'claude-opus-4-6': { contextWindow: 200_000, responseMax: 32_768 },
  'claude-sonnet-4-5': { contextWindow: 200_000, responseMax: 16_384 },
  'claude-sonnet-4-6': { contextWindow: 200_000, responseMax: 16_384 },
  'claude-haiku-4-5': { contextWindow: 200_000, responseMax: 8_192 },
  // OpenAI
  'gpt-4o': { contextWindow: 128_000, responseMax: 16_384 },
  'gpt-4o-mini': { contextWindow: 128_000, responseMax: 16_384 },
  'gpt-4.1': { contextWindow: 1_000_000, responseMax: 32_768 },
  'gpt-4.1-mini': { contextWindow: 1_000_000, responseMax: 32_768 },
  // Google
  'gemini-2.0-flash': { contextWindow: 1_000_000, responseMax: 8_192 },
  'gemini-2.0-flash-lite': { contextWindow: 1_000_000, responseMax: 8_192 },
  'gemini-2.5-pro': { contextWindow: 2_000_000, responseMax: 65_536 },
  'gemini-2.5-flash': { contextWindow: 1_000_000, responseMax: 65_536 },
};

export const DEFAULT_BUDGET: TokenBudget = {
  totalLimit: 200_000,
  budgetRatio: 0.7,
  systemReserve: 10_000,
  responseReserve: 8_192,
};

export interface ContextWindow {
  systemPrompt: string;
  messages: Message[];
  estimatedTokens: number;
  budget: TokenBudget;
}

export interface SnipRule {
  maxTokens: number;
  maxAgeTurns: number;
  keepTokens: number;
}
