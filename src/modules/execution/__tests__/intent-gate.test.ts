import { describe, it, expect } from 'bun:test';
import { classifyByRules, runIntentGate } from '../intent-gate';
import { DEFAULT_INTENT_GATE_CONFIG } from '../execution.types';
import type { ExecutionStep } from '../execution.types';

const noCache = async () => null;
const noop = async () => {};

describe('classifyByRules', () => {
  it('classifies critical step as ops', () => {
    const steps: ExecutionStep[] = [{ id: 's1', type: 'skill', skillId: 'test', riskClass: 'critical' }];
    const result = classifyByRules(steps);
    expect(result?.category).toBe('ops');
    expect(result?.method).toBe('rules');
  });
  it('classifies gate step as ops', () => {
    expect(classifyByRules([{ id: 's1', type: 'gate' }])?.category).toBe('ops');
  });
  it('classifies agent step as deep', () => {
    expect(classifyByRules([{ id: 's1', type: 'agent', agentId: 'a1' }])?.category).toBe('deep');
  });
  it('classifies skill-only steps as quick', () => {
    expect(classifyByRules([{ id: 's1', type: 'skill', skillId: 'a' }, { id: 's2', type: 'skill', skillId: 'b' }])?.category).toBe('quick');
  });
  it('returns null for unresolved steps', () => {
    expect(classifyByRules([{ id: 's1', type: 'decision' }])).toBeNull();
  });
});

describe('runIntentGate', () => {
  it('returns allow when gate disabled', async () => {
    const result = await runIntentGate([], {}, { ...DEFAULT_INTENT_GATE_CONFIG, enabled: false }, noCache, noop);
    expect(result.decision).toBe('allow');
  });
  it('requires approval for critical steps', async () => {
    const steps: ExecutionStep[] = [{ id: 's1', type: 'skill', skillId: 'test', riskClass: 'critical' }];
    const result = await runIntentGate(steps, {}, { ...DEFAULT_INTENT_GATE_CONFIG, llmFallback: false }, noCache, noop);
    expect(result.decision).toBe('require_approval');
  });
  it('falls back to quick when llm disabled and rules unresolved', async () => {
    const steps: ExecutionStep[] = [{ id: 's1', type: 'decision' }];
    const result = await runIntentGate(steps, {}, { ...DEFAULT_INTENT_GATE_CONFIG, llmFallback: false }, noCache, noop);
    expect(result.classification.category).toBe('quick');
  });
  it('uses cached result', async () => {
    const cached = JSON.stringify({ category: 'visual', confidence: 0.9, method: 'llm', cached: false });
    const result = await runIntentGate([{ id: 's1', type: 'decision' }], {}, { ...DEFAULT_INTENT_GATE_CONFIG, llmFallback: true }, async () => cached, noop);
    expect(result.classification.category).toBe('visual');
    expect(result.classification.cached).toBe(true);
  });
});
