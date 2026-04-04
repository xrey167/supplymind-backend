import { describe, test, expect } from 'bun:test';
import { toAnthropicTools } from '../adapters/anthropic';
import { toOpenAITools } from '../adapters/openai';
import { toGoogleTools } from '../adapters/google';
import { toVercelAITools } from '../adapters/vercel-ai';
import type { ToolInfo } from '../types';

const tools: ToolInfo[] = [
  { name: 'echo', description: 'Echoes', inputSchema: { type: 'object' } },
  { name: 'time', description: 'Time', inputSchema: { type: 'object', properties: {} } },
];

describe('SDK adapters', () => {
  test('toAnthropicTools', () => {
    const result = toAnthropicTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'echo', description: 'Echoes', input_schema: { type: 'object' } });
  });

  test('toOpenAITools', () => {
    const result = toOpenAITools(tools);
    expect(result[0]).toEqual({
      type: 'function',
      function: { name: 'echo', description: 'Echoes', parameters: { type: 'object' } },
    });
  });

  test('toGoogleTools', () => {
    const result = toGoogleTools(tools);
    expect(result.functionDeclarations).toHaveLength(2);
    expect(result.functionDeclarations[0].name).toBe('echo');
  });

  test('toVercelAITools', () => {
    const result = toVercelAITools(tools);
    expect(result.echo).toEqual({ description: 'Echoes', parameters: { type: 'object' } });
    expect(result.time).toBeDefined();
  });
});
