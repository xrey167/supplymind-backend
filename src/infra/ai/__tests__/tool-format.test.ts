import { describe, test, expect } from 'bun:test';
import { toAnthropicTools, toOpenAITools, toGoogleTools, toAnthropicToolChoice, toOpenAIToolChoice, toGoogleToolConfig } from '../tool-format';
import type { ToolDefinition } from '../types';

const baseTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get weather',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

describe('toAnthropicTools', () => {
  test('maps basic tool definition', () => {
    const result = toAnthropicTools([baseTool]);
    expect(result).toEqual([{
      name: 'get_weather',
      description: 'Get weather',
      input_schema: baseTool.inputSchema,
    }]);
  });

  test('passes through strict flag', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true };
    const result = toAnthropicTools([tool]);
    expect(result[0].strict).toBe(true);
  });

  test('omits strict when not set', () => {
    const result = toAnthropicTools([baseTool]);
    expect(result[0]).not.toHaveProperty('strict');
  });

  test('passes through cache_control', () => {
    const tool: ToolDefinition = { ...baseTool, cacheControl: { type: 'ephemeral' } };
    const result = toAnthropicTools([tool]);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('passes through eager_input_streaming', () => {
    const tool: ToolDefinition = { ...baseTool, eagerInputStreaming: true };
    const result = toAnthropicTools([tool]);
    expect(result[0].eager_input_streaming).toBe(true);
  });
});

describe('toOpenAITools', () => {
  test('maps basic tool definition', () => {
    const result = toOpenAITools([baseTool]);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('get_weather');
    expect(result[0].function.parameters).toEqual(baseTool.inputSchema);
  });

  test('passes through strict flag', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true };
    const result = toOpenAITools([tool]);
    expect(result[0].function.strict).toBe(true);
  });

  test('omits strict when not set', () => {
    const result = toOpenAITools([baseTool]);
    expect(result[0].function).not.toHaveProperty('strict');
  });
});

describe('toGoogleTools', () => {
  test('wraps tools in functionDeclarations', () => {
    const result = toGoogleTools([baseTool]);
    expect(result[0].functionDeclarations).toHaveLength(1);
    expect(result[0].functionDeclarations[0].name).toBe('get_weather');
  });

  test('ignores strict/cache/streaming (Google does not support them)', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true, cacheControl: { type: 'ephemeral' }, eagerInputStreaming: true };
    const result = toGoogleTools([tool]);
    const decl = result[0].functionDeclarations[0];
    expect(decl).not.toHaveProperty('strict');
    expect(decl).not.toHaveProperty('cache_control');
    expect(decl).not.toHaveProperty('eager_input_streaming');
  });
});

describe('toAnthropicToolChoice', () => {
  test('auto', () => {
    expect(toAnthropicToolChoice({ type: 'auto' })).toEqual({ type: 'auto' });
  });
  test('any', () => {
    expect(toAnthropicToolChoice({ type: 'any' })).toEqual({ type: 'any' });
  });
  test('specific tool', () => {
    expect(toAnthropicToolChoice({ type: 'tool', name: 'get_weather' })).toEqual({ type: 'tool', name: 'get_weather' });
  });
  test('none falls back to auto', () => {
    expect(toAnthropicToolChoice({ type: 'none' })).toEqual({ type: 'auto' });
  });
});

describe('toOpenAIToolChoice', () => {
  test('auto', () => {
    expect(toOpenAIToolChoice({ type: 'auto' })).toBe('auto');
  });
  test('any maps to required', () => {
    expect(toOpenAIToolChoice({ type: 'any' })).toBe('required');
  });
  test('specific tool', () => {
    expect(toOpenAIToolChoice({ type: 'tool', name: 'get_weather' })).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });
  test('none', () => {
    expect(toOpenAIToolChoice({ type: 'none' })).toBe('none');
  });
});

describe('toGoogleToolConfig', () => {
  test('auto', () => {
    expect(toGoogleToolConfig({ type: 'auto' })).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });
  test('any', () => {
    expect(toGoogleToolConfig({ type: 'any' })).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });
  test('specific tool', () => {
    expect(toGoogleToolConfig({ type: 'tool', name: 'get_weather' })).toEqual({ functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] } });
  });
  test('none', () => {
    expect(toGoogleToolConfig({ type: 'none' })).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });
});
