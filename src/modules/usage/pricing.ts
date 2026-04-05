type PricingEntry = { input: number; output: number };

// USD per 1,000,000 tokens
const PRICING: Record<string, PricingEntry> = {
  // Anthropic
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':          { input:  3.00, output: 15.00 },
  'claude-sonnet-4-5':          { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':           { input:  0.80, output:  4.00 },
  'claude-haiku-4-5-20251001':  { input:  0.80, output:  4.00 },
  'claude-3-5-sonnet-20241022': { input:  3.00, output: 15.00 },
  'claude-3-5-haiku-20241022':  { input:  0.80, output:  4.00 },
  'claude-3-opus-20240229':     { input: 15.00, output: 75.00 },
  // OpenAI
  'gpt-4o':                     { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                { input:  0.15, output:  0.60 },
  'gpt-4-turbo':                { input: 10.00, output: 30.00 },
  // Google
  'gemini-1.5-pro':             { input:  1.25, output:  5.00 },
  'gemini-1.5-flash':           { input:  0.075,output:  0.30 },
  'gemini-2.0-flash':           { input:  0.10, output:  0.40 },
};

const FALLBACK: PricingEntry = { input: 1.00, output: 3.00 };

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] ?? FALLBACK;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function resolveProvider(model: string): 'anthropic' | 'openai' | 'google' {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o2') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini')) return 'google';
  // Unknown model — log and fall back to anthropic to avoid DB enum constraint violation
  return 'anthropic';
}
