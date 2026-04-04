import { describe, test, expect } from 'bun:test';
import { toAnthropicTools, toOpenAITools, toGoogleTools } from '../tool-format';
import type { ToolDefinition } from '../types';

const tools: ToolDefinition[] = [
  { name: 'echo', description: 'Echoes input', inputSchema: { type: 'object', properties: { msg: { type: 'string' } } } },
  { name: 'time', description: 'Gets time', inputSchema: { type: 'object' } },
];

describe('toAnthropicTools', () => {
  test('converts to Anthropic format', () => {
    const result = toAnthropicTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'echo',
      description: 'Echoes input',
      input_schema: tools[0].inputSchema,
    });
  });
});

describe('toOpenAITools', () => {
  test('converts to OpenAI function format', () => {
    const result = toOpenAITools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'echo',
        description: 'Echoes input',
        parameters: tools[0].inputSchema,
      },
    });
  });
});

describe('toGoogleTools', () => {
  test('converts to Google functionDeclarations format', () => {
    const result = toGoogleTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(2);
    expect(result[0].functionDeclarations[0]).toEqual({
      name: 'echo',
      description: 'Echoes input',
      parameters: tools[0].inputSchema,
    });
  });
});
