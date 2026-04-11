import { describe, test, expect, beforeEach } from 'bun:test';
import { SkillRegistry } from '../skills.registry';
import { ok } from '../../../core/result';
import type { Skill } from '../skills.types';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'test:echo',
    name: 'echo',
    description: 'Echo skill',
    inputSchema: { type: 'object' },
    providerType: 'builtin',
    priority: 10,
    handler: async (args) => ok(args),
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  test('register and get a skill', () => {
    const skill = makeSkill();
    registry.register(skill);
    expect(registry.get('echo')).toBe(skill);
    expect(registry.has('echo')).toBe(true);
  });

  test('list returns all registered skills', () => {
    registry.register(makeSkill({ name: 'a', id: 'test:a' }));
    registry.register(makeSkill({ name: 'b', id: 'test:b' }));
    expect(registry.list()).toHaveLength(2);
  });

  test('higher priority replaces lower priority', () => {
    registry.register(makeSkill({ priority: 10 }));
    const high = makeSkill({ priority: 30 });
    registry.register(high);
    expect(registry.get('echo')).toBe(high);
  });

  test('lower priority does not replace higher', () => {
    const high = makeSkill({ priority: 30 });
    registry.register(high);
    registry.register(makeSkill({ priority: 10 }));
    expect(registry.get('echo')).toBe(high);
  });

  test('unregister removes a skill', () => {
    registry.register(makeSkill());
    registry.unregister('echo');
    expect(registry.has('echo')).toBe(false);
  });

  test('invoke calls handler and returns result', async () => {
    registry.register(makeSkill({ handler: async () => ok('hello') }));
    const result = await registry.invoke('echo', {});
    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  test('invoke returns error for unknown skill', async () => {
    const result = await registry.invoke('nope', {});
    expect(result.ok).toBe(false);
  });

  test('invoke catches handler errors', async () => {
    registry.register(makeSkill({ handler: async () => { throw new Error('boom'); } }));
    const result = await registry.invoke('echo', {});
    expect(result.ok).toBe(false);
  });

  test('toToolDefinitions maps skills to tool format', () => {
    registry.register(makeSkill());
    const defs = registry.toToolDefinitions();
    expect(defs).toEqual([{ name: 'echo', description: 'Echo skill', inputSchema: { type: 'object' } }]);
  });

  test('toToolDefinitions passes strict from toolHints', () => {
    registry.register(makeSkill({ toolHints: { strict: true } }));
    const defs = registry.toToolDefinitions();
    expect(defs[0].strict).toBe(true);
  });

  test('toToolDefinitions passes cacheControl when cacheable', () => {
    registry.register(makeSkill({ toolHints: { cacheable: true } }));
    const defs = registry.toToolDefinitions();
    expect(defs[0].cacheControl).toEqual({ type: 'ephemeral' });
  });

  test('toToolDefinitions omits cacheControl when cacheable is false', () => {
    registry.register(makeSkill({ toolHints: { cacheable: false } }));
    const defs = registry.toToolDefinitions();
    expect(defs[0]).not.toHaveProperty('cacheControl');
  });

  test('toToolDefinitions passes eagerInputStreaming from toolHints', () => {
    registry.register(makeSkill({ toolHints: { eagerInputStreaming: false } }));
    const defs = registry.toToolDefinitions();
    expect(defs[0].eagerInputStreaming).toBe(false);
  });

  test('toToolDefinitions omits toolHints fields when no toolHints set', () => {
    registry.register(makeSkill());
    const defs = registry.toToolDefinitions();
    expect(defs[0]).not.toHaveProperty('strict');
    expect(defs[0]).not.toHaveProperty('cacheControl');
    expect(defs[0]).not.toHaveProperty('eagerInputStreaming');
  });

  test('clear removes all skills', () => {
    registry.register(makeSkill());
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  test('loadFromProviders registers all provider skills', async () => {
    const provider = {
      type: 'builtin' as const,
      priority: 10,
      loadSkills: async () => [makeSkill({ name: 'x', id: 'test:x' }), makeSkill({ name: 'y', id: 'test:y' })],
    };
    await registry.loadFromProviders([provider]);
    expect(registry.list()).toHaveLength(2);
  });
});
