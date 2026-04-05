import { describe, test, expect } from 'bun:test';
import { toToolDef } from '../tools.mapper';

const makeRow = (overrides?: Partial<any>) => ({
  id: 'row-id-1',
  workspaceId: 'ws-abc',
  name: 'sample_tool',
  description: 'Does something',
  providerType: 'builtin',
  priority: 10,
  inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
  handlerConfig: { key: 'value' },
  enabled: true,
  createdAt: new Date('2024-06-01T00:00:00Z'),
  updatedAt: new Date('2024-06-02T00:00:00Z'),
  ...overrides,
});

describe('toToolDef', () => {
  test('should map all fields from a complete row', () => {
    const row = makeRow();
    const def = toToolDef(row);

    expect(def.id).toBe('row-id-1');
    expect(def.workspaceId).toBe('ws-abc');
    expect(def.name).toBe('sample_tool');
    expect(def.description).toBe('Does something');
    expect(def.providerType).toBe('builtin');
    expect(def.priority).toBe(10);
    expect(def.inputSchema).toEqual({ type: 'object', properties: { x: { type: 'number' } } });
    expect(def.handlerConfig).toEqual({ key: 'value' });
    expect(def.enabled).toBe(true);
    expect(def.createdAt).toEqual(new Date('2024-06-01T00:00:00Z'));
    expect(def.updatedAt).toEqual(new Date('2024-06-02T00:00:00Z'));
  });

  test('should default priority to 0 when row.priority is null', () => {
    const def = toToolDef(makeRow({ priority: null }));
    expect(def.priority).toBe(0);
  });

  test('should default inputSchema to empty object when null', () => {
    const def = toToolDef(makeRow({ inputSchema: null }));
    expect(def.inputSchema).toEqual({});
  });

  test('should default handlerConfig to builtin when null', () => {
    const def = toToolDef(makeRow({ handlerConfig: null }));
    expect(def.handlerConfig).toEqual({ type: 'builtin' });
  });

  test('should default enabled to true when null', () => {
    const def = toToolDef(makeRow({ enabled: null }));
    expect(def.enabled).toBe(true);
  });

  test('should preserve workspaceId as null for global tools', () => {
    const def = toToolDef(makeRow({ workspaceId: null }));
    expect(def.workspaceId).toBeNull();
  });

  test('should map providerType exactly as provided', () => {
    for (const pt of ['builtin', 'mcp', 'worker', 'inline', 'plugin']) {
      const def = toToolDef(makeRow({ providerType: pt }));
      expect(def.providerType).toBe(pt);
    }
  });

  test('should pass through createdAt and updatedAt dates unchanged', () => {
    const created = new Date('2023-01-15T10:00:00Z');
    const updated = new Date('2023-03-20T18:30:00Z');
    const def = toToolDef(makeRow({ createdAt: created, updatedAt: updated }));
    expect(def.createdAt).toBe(created);
    expect(def.updatedAt).toBe(updated);
  });
});
