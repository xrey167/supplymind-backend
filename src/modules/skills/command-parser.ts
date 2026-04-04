import { skillRegistry } from './skills.registry';

export interface ParsedCommand {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Parse a slash command string into a skill invocation.
 *
 * Formats:
 *   /skill_name                    → { name: 'skill_name', args: {} }
 *   /skill_name {"key": "value"}   → { name: 'skill_name', args: { key: 'value' } }
 *   /skill_name some text here     → { name: 'skill_name', args: { input: 'some text here' } }
 *
 * Returns undefined if the input is not a slash command or skill not found.
 */
export function parseCommand(input: string): ParsedCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return undefined;

  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);

  if (!name || !skillRegistry.has(name)) return undefined;

  if (spaceIdx === -1) {
    return { name, args: {} };
  }

  const rest = trimmed.slice(spaceIdx + 1).trim();
  if (!rest) return { name, args: {} };

  // Try JSON first
  if (rest.startsWith('{')) {
    try {
      const parsed = JSON.parse(rest);
      if (typeof parsed === 'object' && parsed !== null) {
        return { name, args: parsed };
      }
    } catch {
      // Not valid JSON, treat as text
    }
  }

  return { name, args: { input: rest } };
}
