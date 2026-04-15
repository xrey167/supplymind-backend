import { skillRegistry } from '../skills/skills.registry';
import type { CommandDto, CommandSource } from './commands.schemas';
import type { SkillProviderType } from '../skills/skills.types';

function toSource(providerType: SkillProviderType): CommandSource {
  if (providerType === 'plugin') return 'global';
  if (providerType === 'builtin') return 'builtin';
  return 'workspace';
}

export const commandsService = {
  list(filter?: { source?: CommandSource }): CommandDto[] {
    return skillRegistry
      .list()
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        inputSchema: skill.inputSchema,
        source: toSource(skill.providerType),
        providerType: skill.providerType,
      }))
      .filter((cmd) => !filter?.source || cmd.source === filter.source);
  },
};
