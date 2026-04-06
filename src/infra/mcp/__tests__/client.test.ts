import { describe, it, expect } from 'bun:test';
import type { McpResourceDef, McpPromptDef, SkillMcpConfig, SkillMcpServerEntry } from '../types';

describe('MCP types', () => {
  it('McpResourceDef has required fields', () => {
    const r: McpResourceDef = {
      uri: 'file:///data.json',
      name: 'data',
      description: 'some data',
      mimeType: 'application/json',
    };
    expect(r.uri).toBe('file:///data.json');
  });

  it('McpPromptDef has required fields', () => {
    const p: McpPromptDef = {
      name: 'summarize',
      description: 'summarize text',
      arguments: [{ name: 'text', description: 'Input text', required: true }],
    };
    expect(p.name).toBe('summarize');
  });

  it('SkillMcpConfig is a record of transport configs', () => {
    const c: SkillMcpConfig = {
      myServer: { type: 'streamable-http', url: 'http://localhost:3000' },
      anotherServer: { type: 'stdio', command: 'node', args: ['server.js'] },
    };
    expect(Object.keys(c)).toHaveLength(2);
  });

  it('SkillMcpServerEntry narrows correctly by type discriminant', () => {
    const entry: SkillMcpServerEntry = { type: 'stdio', command: 'node', args: ['server.js'] };
    if (entry.type === 'stdio') {
      expect(entry.command).toBe('node');
    } else {
      throw new Error('narrowing failed');
    }
  });
});
