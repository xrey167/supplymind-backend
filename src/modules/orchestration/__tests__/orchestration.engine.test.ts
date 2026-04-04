import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../skills/skills.dispatch', () => ({
  dispatchSkill: mock(async (_name: string, args: any) => ({
    ok: true,
    value: { echo: args },
  })),
}));

import { runOrchestration } from '../orchestration.engine';
import type { OrchestrationDefinition } from '../orchestration.types';
import * as skillsDispatch from '../../skills/skills.dispatch';

describe('runOrchestration', () => {
  test('executes single skill step', async () => {
    const def: OrchestrationDefinition = {
      steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'hello' } }],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('completed');
    expect(result.stepResults.s1.status).toBe('completed');
  });

  test('executes steps in dependency order', async () => {
    const def: OrchestrationDefinition = {
      steps: [
        { id: 's2', type: 'skill', skillId: 'echo', args: { msg: 'second' }, dependsOn: ['s1'] },
        { id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'first' } },
      ],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('completed');
    expect(Object.keys(result.stepResults)).toContain('s1');
    expect(Object.keys(result.stepResults)).toContain('s2');
  });

  test('skips step when condition is false', async () => {
    const def: OrchestrationDefinition = {
      steps: [
        { id: 's1', type: 'skill', skillId: 'echo', args: {} },
        { id: 's2', type: 'skill', skillId: 'echo', args: {}, dependsOn: ['s1'], when: '0 > 1' },
      ],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.stepResults.s2.status).toBe('skipped');
  });

  test('gate step calls onGate callback', async () => {
    const def: OrchestrationDefinition = {
      steps: [{ id: 'g1', type: 'gate', gatePrompt: 'Approve?' }],
    };
    const result = await runOrchestration(def, 'ws-1', {}, async () => true);
    expect(result.status).toBe('completed');
    expect(result.stepResults.g1.status).toBe('completed');
  });

  test('gate rejection fails the step', async () => {
    const def: OrchestrationDefinition = {
      steps: [{ id: 'g1', type: 'gate', gatePrompt: 'Approve?' }],
    };
    const result = await runOrchestration(def, 'ws-1', {}, async () => false);
    expect(result.status).toBe('failed');
    expect(result.stepResults.g1.status).toBe('failed');
  });

  test('should retry then succeed when step has onError: retry and maxRetries: 2', async () => {
    let callCount = 0;
    (skillsDispatch.dispatchSkill as ReturnType<typeof mock>).mockImplementation(async (_name: string, args: any) => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, error: new Error('transient failure') };
      }
      return { ok: true, value: { echo: args } };
    });

    const def: OrchestrationDefinition = {
      steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'retry-me' }, onError: 'retry', maxRetries: 2 }],
    };
    const result = await runOrchestration(def, 'ws-1');

    expect(callCount).toBe(2);
    expect(result.status).toBe('completed');
    expect(result.stepResults.s1.status).toBe('completed');
  });

  test('should skip failed step and continue when step has onError: skip', async () => {
    (skillsDispatch.dispatchSkill as ReturnType<typeof mock>).mockImplementation(async (name: string, args: any) => {
      if (name === 'failing-skill') {
        return { ok: false, error: new Error('skill error') };
      }
      return { ok: true, value: { echo: args } };
    });

    const def: OrchestrationDefinition = {
      steps: [
        { id: 's1', type: 'skill', skillId: 'failing-skill', args: {}, onError: 'skip' },
        { id: 's2', type: 'skill', skillId: 'echo', args: { msg: 'after skip' }, dependsOn: ['s1'] },
      ],
    };
    const result = await runOrchestration(def, 'ws-1');

    expect(result.status).toBe('completed');
    expect(result.stepResults.s1.status).toBe('skipped');
    expect(result.stepResults.s2.status).toBe('completed');
  });

  test('should fail with status failed when steps form a circular dependency', async () => {
    (skillsDispatch.dispatchSkill as ReturnType<typeof mock>).mockImplementation(async (_name: string, args: any) => ({
      ok: true,
      value: { echo: args },
    }));

    const def: OrchestrationDefinition = {
      steps: [
        { id: 's1', type: 'skill', skillId: 'echo', args: {}, dependsOn: ['s2'] },
        { id: 's2', type: 'skill', skillId: 'echo', args: {}, dependsOn: ['s1'] },
      ],
    };
    const result = await runOrchestration(def, 'ws-1');

    expect(result.status).toBe('failed');
  });

  test('should fail step after exhausting all retries when every attempt fails', async () => {
    let callCount = 0;
    (skillsDispatch.dispatchSkill as ReturnType<typeof mock>).mockImplementation(async () => {
      callCount++;
      return { ok: false, error: new Error('always fails') };
    });

    const def: OrchestrationDefinition = {
      steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: {}, onError: 'retry', maxRetries: 2 }],
    };
    const result = await runOrchestration(def, 'ws-1');

    expect(callCount).toBe(2);
    expect(result.status).toBe('failed');
    expect(result.stepResults.s1.status).toBe('failed');
    expect(result.stepResults.s1.error).toBe('always fails');
  });
});
