export function resolveTemplate(
  template: string,
  stepResults: Record<string, { result?: unknown }>,
  input?: Record<string, unknown>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path: string) => {
    const parts = path.split('.');

    if (parts[0] === 'steps' && parts.length >= 3) {
      const stepId = parts[1];
      const stepResult = stepResults[stepId];
      if (!stepResult?.result) return match;

      // parts[2] is 'result' — already accessed via stepResult.result; navigate from parts[3]
      let value: unknown = stepResult.result;
      const hasNestedPath = parts.length > 3;
      for (let i = 3; i < parts.length; i++) {
        if (value && typeof value === 'object' && parts[i] in (value as Record<string, unknown>)) {
          value = (value as Record<string, unknown>)[parts[i]];
        } else {
          return match;
        }
      }
      // When accessing a nested field, return strings directly; otherwise always serialize
      if (hasNestedPath && typeof value === 'string') return value;
      return JSON.stringify(value);
    }

    if (parts[0] === 'input' && input) {
      let value: unknown = input;
      for (let i = 1; i < parts.length; i++) {
        if (value && typeof value === 'object' && parts[i] in (value as Record<string, unknown>)) {
          value = (value as Record<string, unknown>)[parts[i]];
        } else {
          return match;
        }
      }
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    return match;
  });
}

export function evaluateCondition(
  condition: string,
  stepResults: Record<string, { result?: unknown }>,
  input?: Record<string, unknown>,
): boolean {
  const resolved = resolveTemplate(condition, stepResults, input);

  const match = resolved.match(/^(.+?)\s*(>=|<=|>|<|===|!==|==|!=)\s*(.+)$/);
  if (!match) return Boolean(resolved);

  const left = parseFloat(match[1]);
  const right = parseFloat(match[3]);
  if (isNaN(left) || isNaN(right)) {
    const op = match[2];
    if (op === '===' || op === '==') return match[1].trim() === match[3].trim();
    if (op === '!==' || op === '!=') return match[1].trim() !== match[3].trim();
    return false;
  }

  switch (match[2]) {
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '===': case '==': return left === right;
    case '!==': case '!=': return left !== right;
    default: return false;
  }
}
