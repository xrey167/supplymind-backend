import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { commandsService } from '../commands.service';
import { skillRegistry } from '../../skills/skills.registry';
import type { Skill } from '../../skills/skills.types';
import { ok } from '../../../core/result';

const makeSkill = (overrides: Partial<Skill>): Skill => ({
  id: 'test-skill-id',
  name: 'test-skill',
  description: 'A test skill',
  inputSchema: { type: 'object', properties: {} },
  providerType: 'builtin',
  priority: 1,
  handler: async () => ok(null),
  ...overrides,
});

describe('commandsService.list', () => {
  beforeEach(() => {
    skillRegistry.clear();
  });

  afterAll(() => {
    skillRegistry.clear();
  });

  it('maps plugin providerType to source=global', () => {
    skillRegistry.register(makeSkill({ id: 'p1', name: 'erp-bc:status', providerType: 'plugin' }));
    const cmds = commandsService.list();
    expect(cmds).toHaveLength(1);
    expect(cmds[0].source).toBe('global');
    expect(cmds[0].name).toBe('erp-bc:status');
  });

  it('maps builtin providerType to source=builtin', () => {
    skillRegistry.register(makeSkill({ id: 'b1', name: 'core:tool', providerType: 'builtin' }));
    const cmds = commandsService.list();
    expect(cmds[0].source).toBe('builtin');
  });

  it('maps mcp/worker/inline providerType to source=workspace', () => {
    skillRegistry.register(makeSkill({ id: 'm1', name: 'mcp-tool', providerType: 'mcp' }));
    skillRegistry.register(makeSkill({ id: 'w1', name: 'worker-task', providerType: 'worker' }));
    const cmds = commandsService.list();
    expect(cmds.every((c) => c.source === 'workspace')).toBe(true);
  });

  it('filters by source when specified', () => {
    skillRegistry.register(makeSkill({ id: 'g1', name: 'global-cmd', providerType: 'plugin' }));
    skillRegistry.register(makeSkill({ id: 'ws1', name: 'workspace-cmd', providerType: 'mcp' }));
    skillRegistry.register(makeSkill({ id: 'bi1', name: 'builtin-cmd', providerType: 'builtin' }));
    const globals = commandsService.list({ source: 'global' });
    expect(globals).toHaveLength(1);
    expect(globals[0].name).toBe('global-cmd');
  });

  it('returns all commands when no filter provided', () => {
    skillRegistry.register(makeSkill({ id: 'a', name: 'a', providerType: 'plugin' }));
    skillRegistry.register(makeSkill({ id: 'b', name: 'b', providerType: 'builtin' }));
    skillRegistry.register(makeSkill({ id: 'c', name: 'c', providerType: 'mcp' }));
    expect(commandsService.list()).toHaveLength(3);
  });

  it('returns empty array when no skills registered', () => {
    expect(commandsService.list()).toHaveLength(0);
  });

  it('includes inputSchema and providerType in output', () => {
    const schema = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };
    skillRegistry.register(makeSkill({ id: 'cmd', name: 'cmd', providerType: 'plugin', inputSchema: schema }));
    const cmd = commandsService.list()[0];
    expect(cmd.inputSchema).toEqual(schema);
    expect(cmd.providerType).toBe('plugin');
  });
});
