import type { Message } from '../../infra/ai/types';
import { MODEL_LIMITS, DEFAULT_BUDGET, type TokenBudget } from './context.types';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.0);
}

export function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === 'string') {
    return estimateTokens(msg.content) + 4;
  }
  let total = 4;
  for (const block of msg.content as any[]) {
    if (block.text) total += estimateTokens(block.text);
    if (block.input) total += estimateTokens(JSON.stringify(block.input));
    if (block.content) total += estimateTokens(block.content);
  }
  return total;
}

export function totalMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function getBudget(model: string): TokenBudget {
  const limits = MODEL_LIMITS[model];
  if (!limits) return DEFAULT_BUDGET;
  return {
    totalLimit: limits.contextWindow,
    budgetRatio: 0.7,
    systemReserve: 10_000,
    responseReserve: limits.responseMax,
  };
}

export function messageBudget(budget: TokenBudget): number {
  return Math.floor(budget.totalLimit * budget.budgetRatio) - budget.systemReserve - budget.responseReserve;
}
