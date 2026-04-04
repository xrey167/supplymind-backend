import { describe, it, expect } from 'bun:test';
import {
  getCapabilities,
  getContextLimit,
  supportsToolUse,
  supportsExtendedThinking,
} from '../provider-registry';
import { DEFAULT_BUDGET } from '../../../modules/context/context.types';

describe('getContextLimit', () => {
  it('returns 200_000 for claude-sonnet-4-6', () => {
    expect(getContextLimit('anthropic', 'claude-sonnet-4-6')).toBe(200_000);
  });

  it('returns 1_000_000 for gpt-4.1', () => {
    expect(getContextLimit('openai', 'gpt-4.1')).toBe(1_000_000);
  });

  it('returns 2_000_000 for gemini-2.5-pro', () => {
    expect(getContextLimit('google', 'gemini-2.5-pro')).toBe(2_000_000);
  });
});

describe('getCapabilities - extended thinking', () => {
  it('returns supportsExtendedThinking=true for claude-opus-4-6', () => {
    expect(getCapabilities('anthropic', 'claude-opus-4-6').supportsExtendedThinking).toBe(true);
  });

  it('returns supportsExtendedThinking=false for gpt-4o', () => {
    expect(getCapabilities('openai', 'gpt-4o').supportsExtendedThinking).toBe(false);
  });
});

describe('unknown model fallback', () => {
  it('falls back to provider defaults and DEFAULT_BUDGET limits', () => {
    const caps = getCapabilities('anthropic', 'unknown-model-xyz');
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
    expect(caps.supportsExtendedThinking).toBe(false);
    expect(caps.maxContextTokens).toBe(DEFAULT_BUDGET.totalLimit);
    expect(caps.maxOutputTokens).toBe(DEFAULT_BUDGET.responseReserve);
  });

  it('falls back to openai provider defaults for unknown openai model', () => {
    const caps = getCapabilities('openai', 'gpt-unknown');
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
    expect(caps.supportsExtendedThinking).toBe(false);
  });
});

describe('supportsToolUse', () => {
  it('returns true for anthropic models', () => {
    expect(supportsToolUse('anthropic', 'claude-sonnet-4-6')).toBe(true);
  });

  it('returns true for google models', () => {
    expect(supportsToolUse('google', 'gemini-2.5-flash')).toBe(true);
  });
});

describe('supportsExtendedThinking', () => {
  it('returns true for claude-sonnet-4-5', () => {
    expect(supportsExtendedThinking('anthropic', 'claude-sonnet-4-5')).toBe(true);
  });

  it('returns false for claude-haiku-4-5', () => {
    expect(supportsExtendedThinking('anthropic', 'claude-haiku-4-5')).toBe(false);
  });
});
