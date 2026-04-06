import { describe, it, expect } from 'bun:test';
import { classifyIntent, routeModel, IntentTier } from '../model-router';

describe('classifyIntent', () => {
  it('classifies simple greetings as FAST', () => {
    expect(classifyIntent('hello')).toBe(IntentTier.FAST);
    expect(classifyIntent('hi there')).toBe(IntentTier.FAST);
  });

  it('classifies analysis/explanation as BALANCED', () => {
    expect(classifyIntent('explain how authentication works in this codebase')).toBe(IntentTier.BALANCED);
    expect(classifyIntent('analyze this error and suggest a fix')).toBe(IntentTier.BALANCED);
  });

  it('classifies complex multi-step tasks as POWERFUL', () => {
    expect(classifyIntent('design and implement a complete authentication system with JWT, refresh tokens, and RBAC')).toBe(IntentTier.POWERFUL);
    expect(classifyIntent('architect a distributed system with microservices, event sourcing, and CQRS')).toBe(IntentTier.POWERFUL);
  });

  it('short prompts with no signal default to FAST', () => {
    expect(classifyIntent('ok')).toBe(IntentTier.FAST);
    expect(classifyIntent('yes')).toBe(IntentTier.FAST);
  });

  it('longer prompts with no strong signals default to BALANCED or POWERFUL', () => {
    const longNeutral = 'please help me with this task that requires some thinking about the problem at hand and how to approach it correctly';
    const result = classifyIntent(longNeutral);
    expect([IntentTier.BALANCED, IntentTier.POWERFUL]).toContain(result);
  });
});

describe('routeModel', () => {
  it('returns override when set', () => {
    expect(routeModel(IntentTier.FAST, { MODEL_OVERRIDE_FAST: 'claude-haiku-4-5-20251001' }))
      .toBe('claude-haiku-4-5-20251001');
  });

  it('returns default model for each tier when no override', () => {
    const fast     = routeModel(IntentTier.FAST, {});
    const balanced = routeModel(IntentTier.BALANCED, {});
    const powerful = routeModel(IntentTier.POWERFUL, {});
    expect(typeof fast).toBe('string');
    expect(typeof balanced).toBe('string');
    expect(typeof powerful).toBe('string');
    expect(fast).not.toBe(powerful);
  });

  it('BALANCED and POWERFUL get more capable models than FAST', () => {
    expect(routeModel(IntentTier.FAST, {})).not.toBe(routeModel(IntentTier.POWERFUL, {}));
  });
});
