import { describe, it, expect } from 'bun:test';
import { buildTool, TOOL_DEFAULTS } from '../tool-contract';

describe('buildTool', () => {
  it('creates a tool with required fields', () => {
    const tool = buildTool({
      name: 'get_order',
      description: 'Fetch an order by ID',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }: { id: string }) => ({ orderId: id, status: 'pending' }),
    });
    expect(tool.name).toBe('get_order');
    expect(tool.description).toBe('Fetch an order by ID');
    expect(typeof tool.execute).toBe('function');
  });

  it('execute returns the resolved value', async () => {
    const tool = buildTool({
      name: 'add',
      description: 'Add two numbers',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      execute: async ({ a, b }: { a: number; b: number }) => a + b,
    });
    const result = await tool.execute({ a: 2, b: 3 });
    expect(result).toBe(5);
  });

  it('merges options with TOOL_DEFAULTS', () => {
    const tool = buildTool({
      name: 'noop',
      description: 'Does nothing',
      inputSchema: {},
      execute: async () => null,
      options: { timeout: 5000 },
    });
    expect(tool.options.timeout).toBe(5000);
    expect(tool.options.retries).toBe(TOOL_DEFAULTS.retries);
  });

  it('TOOL_DEFAULTS is frozen', () => {
    expect(Object.isFrozen(TOOL_DEFAULTS)).toBe(true);
  });

  it('TOOL_DEFAULTS is immutable at runtime', () => {
    expect(() => {
      (TOOL_DEFAULTS as any).retries = 999;
    }).toThrow();
  });

  it('supports deferLoading flag', () => {
    const tool = buildTool({
      name: 'heavy_tool',
      description: 'Loads lazily',
      inputSchema: {},
      execute: async () => 'ok',
      options: { deferLoading: true },
    });
    expect(tool.options.deferLoading).toBe(true);
  });

  it('tool name is accessible for registration', () => {
    const tool = buildTool({
      name: 'my_tool',
      description: 'test',
      inputSchema: {},
      execute: async () => undefined,
    });
    expect(tool.name).toBe('my_tool');
  });
});
