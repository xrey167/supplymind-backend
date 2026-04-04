import { describe, test, expect, beforeEach } from 'bun:test';
import { createRuntime } from '../runtime-factory';
import { AnthropicRawRuntime } from '../anthropic';
import { OpenAIRawRuntime } from '../openai';
import { GoogleRawRuntime } from '../google';
import { AnthropicAgentSdkRuntime } from '../anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from '../openai-agents';

describe('createRuntime', () => {
  beforeEach(() => {
    // Set dummy API keys for testing
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GOOGLE_API_KEY = 'test-google-key';
  });

  test('raw + anthropic returns AnthropicRawRuntime', () => {
    const rt = createRuntime('anthropic', 'raw');
    expect(rt).toBeInstanceOf(AnthropicRawRuntime);
  });

  test('raw + openai returns OpenAIRawRuntime', () => {
    const rt = createRuntime('openai', 'raw');
    expect(rt).toBeInstanceOf(OpenAIRawRuntime);
  });

  test('raw + google returns GoogleRawRuntime', () => {
    const rt = createRuntime('google', 'raw');
    expect(rt).toBeInstanceOf(GoogleRawRuntime);
  });

  test('agent-sdk + anthropic returns AnthropicAgentSdkRuntime', () => {
    const rt = createRuntime('anthropic', 'agent-sdk');
    expect(rt).toBeInstanceOf(AnthropicAgentSdkRuntime);
  });

  test('agent-sdk + openai returns OpenAIAgentSdkRuntime', () => {
    const rt = createRuntime('openai', 'agent-sdk');
    expect(rt).toBeInstanceOf(OpenAIAgentSdkRuntime);
  });

  test('agent-sdk + google throws', () => {
    expect(() => createRuntime('google', 'agent-sdk')).toThrow('No agent-sdk runtime');
  });

  test('unknown provider throws', () => {
    expect(() => createRuntime('unknown' as any, 'raw')).toThrow();
  });
});
