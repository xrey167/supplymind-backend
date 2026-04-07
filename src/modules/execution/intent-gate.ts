import { createHash } from 'crypto';
import { logger } from '../../config/logger';
import type { ExecutionStep, IntentClassification, IntentGateConfig } from './execution.types';

export function classifyByRules(steps: ExecutionStep[]): IntentClassification | null {
  if (steps.some(s => s.riskClass === 'critical')) {
    return { category: 'ops', confidence: 1.0, method: 'rules', cached: false };
  }
  if (steps.some(s => s.type === 'gate' || s.approvalMode === 'required')) {
    return { category: 'ops', confidence: 0.95, method: 'rules', cached: false };
  }
  if (steps.some(s => s.type === 'agent')) {
    return { category: 'deep', confidence: 0.85, method: 'rules', cached: false };
  }
  if (steps.some(s => s.type === 'collaboration')) {
    return { category: 'deep', confidence: 0.85, method: 'rules', cached: false };
  }
  if (steps.every(s => s.type === 'skill') && !steps.some(s => s.riskClass === 'high')) {
    return { category: 'quick', confidence: 0.9, method: 'rules', cached: false };
  }
  return null;
}

function planCacheKey(steps: ExecutionStep[], input: Record<string, unknown>): string {
  const payload = JSON.stringify({ steps: steps.map(s => ({ type: s.type, id: s.id, label: (s as any).label })), input });
  return `intent_gate:${createHash('sha256').update(payload).digest('hex')}`;
}

async function classifyByLlm(
  steps: ExecutionStep[],
  input: Record<string, unknown>,
  config: IntentGateConfig,
  getCache: (key: string) => Promise<string | null>,
  setCache: (key: string, value: string, ttlMs: number) => Promise<void>,
): Promise<IntentClassification> {
  const cacheKey = planCacheKey(steps, input);
  const cached = await getCache(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as IntentClassification;
      return { ...parsed, cached: true };
    } catch { /* ignore */ }
  }

  const prompt = `Classify this execution plan into one category: quick (fast skill-only tasks), deep (multi-agent reasoning), visual (UI/screenshot tasks), ops (write actions, approvals, external integrations).

Steps: ${JSON.stringify(steps.map(s => ({ type: s.type, id: s.id, label: (s as any).label ?? s.id })))}
Input keys: ${Object.keys(input).join(', ') || 'none'}

Respond with JSON only: {"category": "quick"|"deep"|"visual"|"ops", "confidence": 0.0-1.0, "reasoning": "one sentence"}`;

  try {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    let category: string = 'quick';
    let confidence = 0.7;
    let reasoning = '';

    try {
      const msg = await client.messages.create(
        {
          model: config.model,
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '{}';
      const parsed = JSON.parse(text);
      category = ['quick', 'deep', 'visual', 'ops'].includes(parsed.category) ? parsed.category : 'quick';
      confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
      reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
    } catch (llmErr) {
      clearTimeout(timeout);
      logger.warn({ err: llmErr }, 'Intent-Gate LLM classification failed — defaulting to quick');
    }

    const result: IntentClassification = { category: category as any, confidence, method: 'llm', reasoning, cached: false };
    await setCache(cacheKey, JSON.stringify(result), 5 * 60 * 1000);
    return result;
  } catch (err) {
    logger.warn({ err }, 'Intent-Gate LLM stage error — defaulting to quick');
    return { category: 'quick', confidence: 0.5, method: 'llm', cached: false };
  }
}

export type GateDecision = 'allow' | 'warn' | 'require_approval' | 'block';

export interface GateResult {
  classification: IntentClassification;
  decision: GateDecision;
  reason: string;
}

export async function runIntentGate(
  steps: ExecutionStep[],
  input: Record<string, unknown>,
  config: IntentGateConfig,
  getCache: (key: string) => Promise<string | null>,
  setCache: (key: string, value: string, ttlMs: number) => Promise<void>,
): Promise<GateResult> {
  if (!config.enabled) {
    return {
      classification: { category: 'quick', confidence: 1.0, method: 'rules', cached: false },
      decision: 'allow',
      reason: 'Intent gate disabled',
    };
  }

  let classification = classifyByRules(steps);

  if (!classification && config.llmFallback) {
    classification = await classifyByLlm(steps, input, config, getCache, setCache);
  } else if (!classification) {
    classification = { category: 'quick', confidence: 0.5, method: 'rules', cached: false };
  }

  const maxRisk = steps.reduce<string>((acc, s) => {
    const ranks: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const stepRisk = s.riskClass ?? 'low';
    return (ranks[stepRisk] ?? 0) > (ranks[acc] ?? 0) ? stepRisk : acc;
  }, 'low');

  const override = (config.riskOverrides as any)[maxRisk] ?? 'allow';
  const catDecision: GateDecision =
    classification.category === 'ops' && override === 'allow' ? 'warn' :
    (override as GateDecision);

  return {
    classification,
    decision: catDecision,
    reason: `Category: ${classification.category}, max risk: ${maxRisk}, override: ${override}`,
  };
}
