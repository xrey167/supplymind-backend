import type { StepResult } from './workflows.types';

const MAX_SUBSTITUTION_LENGTH = 50 * 1024; // 50KB

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SHELL_SKILLS = new Set(['run_shell', 'run_command', 'exec']);
const LLM_SKILLS = new Set(['ask_claude', 'ask_llm', 'generate']);

function sanitizeValue(value: string): string {
  // Strip null bytes and control chars (keep newlines/tabs)
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function escapeForShell(value: string): string {
  // Escape single quotes for shell embedding
  return value.replace(/'/g, "'\\''");
}

function wrapForLLM(value: string): string {
  return `<user_data>${value}</user_data>`;
}

function applySkillSanitization(value: string, skillId?: string): string {
  if (!skillId) return value;
  if (SHELL_SKILLS.has(skillId)) return escapeForShell(value);
  if (LLM_SKILLS.has(skillId)) return wrapForLLM(value);
  return value;
}

function resolveRef(
  path: string,
  stepResults: Map<string, StepResult>,
  input?: Record<string, unknown>,
): string | undefined {
  const parts = path.split('.');
  if (parts.length < 2) return undefined;

  const [root, ...rest] = parts;
  if (DANGEROUS_KEYS.has(root) || rest.some((k) => DANGEROUS_KEYS.has(k))) {
    return undefined;
  }

  if (root === 'input' && input) {
    let current: unknown = input;
    for (const key of rest) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current != null ? String(current) : undefined;
  }

  const stepResult = stepResults.get(root);
  if (!stepResult) return undefined;

  const field = rest[0];
  if (field === 'result') return stepResult.result;
  if (field === 'error') return stepResult.error;
  if (field === 'status') return stepResult.status;

  return undefined;
}

export function resolveTemplate(
  value: string,
  stepResults: Map<string, StepResult>,
  input?: Record<string, unknown>,
  skillId?: string,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, ref: string) => {
    const resolved = resolveRef(ref.trim(), stepResults, input);
    if (resolved == null) return '';

    let sanitized = sanitizeValue(resolved);
    if (sanitized.length > MAX_SUBSTITUTION_LENGTH) {
      sanitized = sanitized.slice(0, MAX_SUBSTITUTION_LENGTH);
    }
    return applySkillSanitization(sanitized, skillId);
  });
}

export function evaluateWhen(
  expr: string,
  stepResults: Map<string, StepResult>,
  _stepStatuses?: Map<string, string>,
  input?: Record<string, unknown>,
): boolean {
  // Resolve template references in the expression
  const resolved = resolveTemplate(expr, stepResults, input);

  // Falsy values
  if (resolved === '' || resolved === 'false' || resolved === '0') {
    return false;
  }

  return true;
}
