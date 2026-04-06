import { describe, it, expect } from 'bun:test';
import { skillMcpConfigSchema } from '../skills.schemas';

describe('skillMcpConfigSchema', () => {
  it('accepts streamable-http entry', () => {
    const result = skillMcpConfigSchema.safeParse({
      analytics: { type: 'streamable-http', url: 'http://localhost:4000' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts stdio entry', () => {
    const result = skillMcpConfigSchema.safeParse({
      myTool: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts sse entry', () => {
    const result = skillMcpConfigSchema.safeParse({
      stream: { type: 'sse', url: 'http://localhost:5000/events' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple entries', () => {
    const result = skillMcpConfigSchema.safeParse({
      analytics: { type: 'streamable-http', url: 'http://localhost:4000' },
      billing: { type: 'stdio', command: 'billing-mcp' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = skillMcpConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects entry without type', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { url: 'http://x.com' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects streamable-http entry without url', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'streamable-http' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects stdio entry without command', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'stdio' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse entry without url', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'sse' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse entry with invalid url', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'sse', url: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects key with spaces or special chars', () => {
    const result = skillMcpConfigSchema.safeParse({
      'bad key!': { type: 'streamable-http', url: 'http://localhost:4000' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts key with hyphens and underscores', () => {
    const result = skillMcpConfigSchema.safeParse({
      'my-server_v2': { type: 'streamable-http', url: 'http://localhost:4000' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'grpc', url: 'http://localhost' },
    });
    expect(result.success).toBe(false);
  });
});
