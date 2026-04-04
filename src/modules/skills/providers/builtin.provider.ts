import { ok } from '../../../core/result';
import type { Skill, SkillProvider } from '../skills.types';

export class BuiltinSkillProvider implements SkillProvider {
  type = 'builtin' as const;
  priority = 10;

  async loadSkills(): Promise<Skill[]> {
    return [
      {
        id: 'builtin:echo',
        name: 'echo',
        description: 'Returns the input arguments as a JSON string',
        inputSchema: { type: 'object', additionalProperties: true },
        providerType: 'builtin',
        priority: this.priority,
        handler: async (args) => ok(JSON.stringify(args)),
      },
      {
        id: 'builtin:get_time',
        name: 'get_time',
        description: 'Returns the current ISO timestamp',
        inputSchema: { type: 'object', properties: {} },
        providerType: 'builtin',
        priority: this.priority,
        handler: async () => ok(new Date().toISOString()),
      },
      {
        id: 'builtin:health_check',
        name: 'health_check',
        description: 'Returns a health check status',
        inputSchema: { type: 'object', properties: {} },
        providerType: 'builtin',
        priority: this.priority,
        handler: async () => ok({ status: 'ok', timestamp: new Date().toISOString() }),
      },
    ];
  }
}
