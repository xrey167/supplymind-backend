export interface ParsedCommand {
  raw: string;
  cmd: string;
  flags: string[];
  args: string[];
  hasSubshell: boolean;
  hasPipe: boolean;
}

/**
 * Split a raw bash string into individual sub-commands.
 * Splits on ; && || | (respecting single/double quotes).
 * Returns one ParsedCommand per sub-command.
 */
export function parseCommands(raw: string): ParsedCommand[] {
  const subCommands = splitOnSeparators(raw);
  return subCommands.map(parseOne);
}

/** Split on ; && || | outside of quotes */
function splitOnSeparators(raw: string): string[] {
  const results: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue; }

    if (!inSingle && !inDouble) {
      if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
        if (current.trim()) results.push(current.trim());
        current = ''; i += 2; continue;
      }
      if (ch === ';' || ch === '|') {
        if (current.trim()) results.push(current.trim());
        current = ''; i++; continue;
      }
    }

    current += ch; i++;
  }

  if (current.trim()) results.push(current.trim());
  return results;
}

/** Parse a single sub-command string into tokens */
function parseOne(raw: string): ParsedCommand {
  const hasSubshell = /\$\(/.test(raw) || /`/.test(raw);
  const hasPipe = raw.includes('|');

  const tokens = tokenize(raw);
  const [cmd = '', ...rest] = tokens;
  const flags = rest.filter(t => t.startsWith('-'));
  const args = rest.filter(t => !t.startsWith('-'));

  return { raw, cmd: cmd.replace(/^sudo\s+/, ''), flags, args, hasSubshell, hasPipe };
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of raw) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
