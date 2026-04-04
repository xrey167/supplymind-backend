import { describe, test, expect, beforeEach } from 'bun:test';
import { listSkills } from '../client';
import { SkillRegistry } from '../../modules/skills/skills.registry';
import { ok } from '../../core/result';

// We test listSkills (in-process) which reads from the singleton registry
// callSkill depends on dispatchSkill which needs the full event system — tested via integration

describe('listSkills', () => {
  test('returns empty array when no skills registered', () => {
    const { skillRegistry } = require('../../modules/skills/skills.registry');
    skillRegistry.clear();
    const skills = listSkills();
    expect(skills).toEqual([]);
  });

  test('returns skill info for registered skills', () => {
    const { skillRegistry } = require('../../modules/skills/skills.registry');
    skillRegistry.clear();
    skillRegistry.register({
      id: 'test:echo',
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => ok('ok'),
    });
    const skills = listSkills();
    expect(skills).toEqual([{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }]);
  });
});
