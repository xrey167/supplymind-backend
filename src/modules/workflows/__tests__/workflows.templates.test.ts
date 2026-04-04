import { describe, test, expect } from 'bun:test';
import { resolveTemplate, evaluateWhen } from '../workflows.templates';
import type { StepResult } from '../workflows.types';

function makeResults(entries: Record<string, Partial<StepResult>>): Map<string, StepResult> {
  const map = new Map<string, StepResult>();
  for (const [id, partial] of Object.entries(entries)) {
    map.set(id, { stepId: id, status: 'completed', durationMs: 0, ...partial });
  }
  return map;
}

describe('resolveTemplate', () => {
  test('substitutes step result references', () => {
    const results = makeResults({ step1: { result: 'hello world' } });
    expect(resolveTemplate('Got: {{step1.result}}', results)).toBe('Got: hello world');
  });

  test('returns empty string for missing references', () => {
    expect(resolveTemplate('{{missing.result}}', new Map())).toBe('');
  });

  test('strips null bytes and control chars', () => {
    const results = makeResults({ s: { result: 'clean\x00\x01\x7Ftext' } });
    expect(resolveTemplate('{{s.result}}', results)).toBe('cleantext');
  });

  test('blocks __proto__ traversal', () => {
    const results = makeResults({ s: { result: 'val' } });
    expect(resolveTemplate('{{__proto__.result}}', results)).toBe('');
    expect(resolveTemplate('{{s.__proto__}}', results)).toBe('');
  });

  test('truncates values exceeding max length', () => {
    const longStr = 'x'.repeat(60_000);
    const results = makeResults({ s: { result: longStr } });
    const resolved = resolveTemplate('{{s.result}}', results);
    expect(resolved.length).toBe(50 * 1024);
  });

  test('escapes shell characters for shell skills', () => {
    const results = makeResults({ s: { result: "it's dangerous" } });
    const resolved = resolveTemplate('{{s.result}}', results, undefined, 'run_shell');
    expect(resolved).toBe("it'\\''s dangerous");
  });

  test('wraps value in XML for LLM skills', () => {
    const results = makeResults({ s: { result: 'user input' } });
    const resolved = resolveTemplate('{{s.result}}', results, undefined, 'ask_claude');
    expect(resolved).toBe('<user_data>user input</user_data>');
  });

  test('resolves input references', () => {
    const input = { name: 'test', nested: { val: 42 } };
    expect(resolveTemplate('{{input.name}}', new Map(), input)).toBe('test');
    expect(resolveTemplate('{{input.nested.val}}', new Map(), input)).toBe('42');
  });
});

describe('evaluateWhen', () => {
  test('returns false for empty/false/zero strings', () => {
    const empty = new Map<string, StepResult>();
    expect(evaluateWhen('', empty)).toBe(false);
    expect(evaluateWhen('false', empty)).toBe(false);
    expect(evaluateWhen('0', empty)).toBe(false);
  });

  test('returns true for truthy resolved values', () => {
    const results = makeResults({ s: { result: 'yes' } });
    expect(evaluateWhen('{{s.result}}', results)).toBe(true);
  });

  test('returns false when reference is missing', () => {
    expect(evaluateWhen('{{missing.result}}', new Map())).toBe(false);
  });
});
