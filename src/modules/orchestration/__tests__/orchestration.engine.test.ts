import { describe, test, expect, mock } from 'bun:test';

mock.module('../../skills/skills.dispatch', () => ({
  dispatchSkill: mock(async (_name: string, args: any) => ({
    ok: true,
    value: { echo: args },
  })),
}));

import { runOrchestration } from '../orchestration.engine';
import type { OrchestrationDefinition } from '../orchestration.types';

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
});
