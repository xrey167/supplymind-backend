import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

import { runOrchestration } from '../orchestration.engine';
import type { OrchestrationDefinition } from '../orchestration.types';
import * as skillsDispatch from '../../skills/skills.dispatch';
import { tasksService } from '../../tasks/tasks.service';
import * as collabEngine from '../../collaboration/collaboration.engine';

// Use spyOn instead of mock.module to avoid polluting skills.dispatch.test.ts
const dispatchSpy = spyOn(skillsDispatch, 'dispatchSkill').mockResolvedValue({
  ok: true,
  value: { echo: {} },
} as any);

const taskSendSpy = spyOn(tasksService, 'send').mockResolvedValue({
  ok: true,
  value: { id: 'task-1', status: { state: 'completed' }, artifacts: [], history: [] },
} as any);

const collaborateSpy = spyOn(collabEngine, 'collaborate').mockResolvedValue({
  id: 'collab-1',
  strategy: 'fan_out',
  output: 'combined result',
  responses: [],
  totalDurationMs: 100,
} as any);

afterAll(() => {
  dispatchSpy.mockRestore();
  taskSendSpy.mockRestore();
  collaborateSpy.mockRestore();
});

describe('runOrchestration', () => {
  beforeEach(() => {
    dispatchSpy.mockReset();
    dispatchSpy.mockResolvedValue({ ok: true, value: { echo: {} } } as any);
    taskSendSpy.mockReset();
    taskSendSpy.mockResolvedValue({
      ok: true,
      value: { id: 'task-1', status: { state: 'completed' }, artifacts: [], history: [] },
    } as any);
    collaborateSpy.mockReset();
    collaborateSpy.mockResolvedValue({
      id: 'collab-1', strategy: 'fan_out', output: 'combined result',
      responses: [], totalDurationMs: 100,
    } as any);
  });

  test('executes single skill step', async () => {
    dispatchSpy.mockImplementation(async (_name: string, args: any) => ({
      ok: true,
      value: { echo: args },
    }));
    const def: OrchestrationDefinition = {
      steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'hello' } }],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('completed');
    expect(result.stepResults.s1.status).toBe('completed');
  });

  test('executes steps in dependency order', async () => {
    dispatchSpy.mockImplementation(async (_name: string, args: any) => ({
      ok: true,
      value: { echo: args },
    }));
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
    dispatchSpy.mockImplementation(async (_name: string, args: any) => ({
      ok: true,
      value: { echo: args },
    }));
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
    dispatchSpy.mockImplementation(async (_name: string, args: any) => {
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
    dispatchSpy.mockImplementation(async (name: string, args: any) => {
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
    dispatchSpy.mockImplementation(async (_name: string, args: any) => ({
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
    dispatchSpy.mockImplementation(async () => {
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

  test('agent step sends task via tasksService', async () => {
    const def: OrchestrationDefinition = {
      steps: [{ id: 'a1', type: 'agent', agentId: 'agent-1', message: 'Analyze data' }],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('completed');
    expect(result.stepResults.a1.status).toBe('completed');
    expect(taskSendSpy).toHaveBeenCalledWith('agent-1', 'Analyze data', 'ws-1', 'orchestration');
  });

  test('agent step fails when task send fails', async () => {
    taskSendSpy.mockResolvedValue({ ok: false, error: new Error('Agent not found') } as any);
    const def: OrchestrationDefinition = {
      steps: [{ id: 'a1', type: 'agent', agentId: 'missing', message: 'Hello' }],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('failed');
    expect(result.stepResults.a1.error).toContain('Agent not found');
  });

  test('collaboration step runs collaborate engine', async () => {
    const def: OrchestrationDefinition = {
      steps: [{
        id: 'c1', type: 'collaboration', strategy: 'fan_out',
        agentIds: ['agent-1', 'agent-2'],
      }],
    };
    const result = await runOrchestration(def, 'ws-1', { query: 'What is X?' });
    expect(result.status).toBe('completed');
    expect(result.stepResults.c1.status).toBe('completed');
    expect(collaborateSpy).toHaveBeenCalled();
  });

  test('decision step picks first completed candidate', async () => {
    dispatchSpy.mockResolvedValue({ ok: true, value: 'done' } as any);
    const def: OrchestrationDefinition = {
      steps: [
        { id: 's1', type: 'skill', skillId: 'echo', args: {} },
        { id: 's2', type: 'skill', skillId: 'echo', args: {} },
        { id: 'd1', type: 'decision', pipelines: ['s1', 's2'], dependsOn: ['s1', 's2'] },
      ],
    };
    const result = await runOrchestration(def, 'ws-1');
    expect(result.status).toBe('completed');
    expect(result.stepResults.d1.status).toBe('completed');
    const decision = result.stepResults.d1.result as any;
    expect(decision.decision).toBe('s1');
  });
});
