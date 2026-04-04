import { describe, test, expect } from 'bun:test';
import { resolveTemplate, evaluateCondition } from '../orchestration.templates';

describe('resolveTemplate', () => {
  const stepResults = {
    s1: { result: { risk: 0.8, name: 'Supplier X' } },
    s2: { result: 'plain string result' },
  };

  test('resolves step result reference', () => {
    expect(resolveTemplate('Risk: ${steps.s1.result.risk}', stepResults)).toBe('Risk: 0.8');
  });

  test('resolves nested step result', () => {
    expect(resolveTemplate('Name: ${steps.s1.result.name}', stepResults)).toBe('Name: Supplier X');
  });

  test('resolves plain step result', () => {
    expect(resolveTemplate('Output: ${steps.s2.result}', stepResults)).toBe('Output: "plain string result"');
  });

  test('resolves input reference', () => {
    expect(resolveTemplate('Query: ${input.query}', {}, { query: 'find suppliers' })).toBe('Query: find suppliers');
  });

  test('preserves unresolvable templates', () => {
    expect(resolveTemplate('${steps.missing.result}', {})).toBe('${steps.missing.result}');
  });
});

describe('evaluateCondition', () => {
  const stepResults = {
    s1: { result: { risk: 0.8 } },
  };

  test('evaluates > correctly', () => {
    expect(evaluateCondition('${steps.s1.result.risk} > 0.7', stepResults)).toBe(true);
    expect(evaluateCondition('${steps.s1.result.risk} > 0.9', stepResults)).toBe(false);
  });

  test('evaluates <= correctly', () => {
    expect(evaluateCondition('${steps.s1.result.risk} <= 0.8', stepResults)).toBe(true);
  });

  test('evaluates == for strings', () => {
    expect(evaluateCondition('hello == hello', {})).toBe(true);
    expect(evaluateCondition('hello == world', {})).toBe(false);
  });
});
