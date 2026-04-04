import { describe, test, expect, beforeEach } from 'bun:test';
import { parseCommand } from '../command-parser';
import { skillRegistry } from '../skills.registry';
import { ok } from '../../../core/result';

describe('parseCommand', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillRegistry.register({
      id: 'get_weather',
      name: 'get_weather',
      description: 'Get weather',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => ok('sunny'),
    });
    skillRegistry.register({
      id: 'echo',
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => ok('ok'),
    });
  });

  test('returns undefined for non-slash input', () => {
    expect(parseCommand('hello world')).toBeUndefined();
  });

  test('returns undefined for unknown skill', () => {
    expect(parseCommand('/unknown_skill')).toBeUndefined();
  });

  test('parses skill name only', () => {
    expect(parseCommand('/echo')).toEqual({ name: 'echo', args: {} });
  });

  test('parses skill with text args', () => {
    expect(parseCommand('/echo hello world')).toEqual({ name: 'echo', args: { input: 'hello world' } });
  });

  test('parses skill with JSON args', () => {
    expect(parseCommand('/get_weather {"city": "London"}')).toEqual({
      name: 'get_weather',
      args: { city: 'London' },
    });
  });

  test('treats invalid JSON as text', () => {
    expect(parseCommand('/echo {not json}')).toEqual({ name: 'echo', args: { input: '{not json}' } });
  });

  test('trims whitespace', () => {
    expect(parseCommand('  /echo  hello  ')).toEqual({ name: 'echo', args: { input: 'hello' } });
  });

  test('handles slash only', () => {
    expect(parseCommand('/')).toBeUndefined();
  });
});
