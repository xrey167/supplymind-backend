import { describe, test, expect } from 'bun:test';
import { executeWorkflow } from '../workflows.engine';
import type { WorkflowDefinition, WorkflowDispatchFn } from '../workflows.types';

const dispatch: WorkflowDispatchFn = async (skillId, args, text) => {
  return `${skillId}:${text || JSON.stringify(args)}`;
};

describe('executeWorkflow', () => {
  test('executes steps in dependency order', async () => {
    const workflow: WorkflowDefinition = {
      id: 'test-1',
      steps: [
        { id: 'a', skillId: 'echo', message: 'first' },
        { id: 'b', skillId: 'echo', message: 'second:{{a.result}}', dependsOn: ['a'] },
      ],
    };
    const result = await executeWorkflow(workflow, dispatch);
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].stepId).toBe('a');
    expect(result.steps[1].result).toContain('echo:first');
  });

  test('runs independent steps in parallel', async () => {
    const order: string[] = [];
    const parallelDispatch: WorkflowDispatchFn = async (skillId, _args, text) => {
      order.push(skillId);
      return `${skillId}:${text}`;
    };
    const workflow: WorkflowDefinition = {
      id: 'parallel',
      steps: [
        { id: 'a', skillId: 'fast-a', message: 'go' },
        { id: 'b', skillId: 'fast-b', message: 'go' },
        { id: 'c', skillId: 'slow', message: '{{a.result}}+{{b.result}}', dependsOn: ['a', 'b'] },
      ],
    };
    const result = await executeWorkflow(workflow, parallelDispatch);
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(3);
    const cIdx = result.steps.findIndex(s => s.stepId === 'c');
    const aIdx = result.steps.findIndex(s => s.stepId === 'a');
    const bIdx = result.steps.findIndex(s => s.stepId === 'b');
    expect(cIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
  });

  test('skip step on error when onError=skip', async () => {
    const failDispatch: WorkflowDispatchFn = async (skillId) => {
      if (skillId === 'fail') throw new Error('boom');
      return 'ok';
    };
    const workflow: WorkflowDefinition = {
      id: 'skip-test',
      steps: [
        { id: 'a', skillId: 'fail', message: 'x', onError: 'skip' },
        { id: 'b', skillId: 'echo', message: 'after' },
      ],
    };
    const result = await executeWorkflow(workflow, failDispatch);
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].status).toBe('completed');
    expect(result.status).toBe('partial');
  });

  test('fail workflow when step fails with onError=fail', async () => {
    const failDispatch: WorkflowDispatchFn = async () => { throw new Error('boom'); };
    const workflow: WorkflowDefinition = {
      id: 'fail-test',
      steps: [
        { id: 'a', skillId: 'fail', message: 'x', onError: 'fail' },
        { id: 'b', skillId: 'echo', message: 'after', dependsOn: ['a'] },
      ],
    };
    const result = await executeWorkflow(workflow, failDispatch);
    expect(result.status).toBe('failed');
    expect(result.steps.find(s => s.stepId === 'a')?.status).toBe('failed');
  });

  test('when conditional skips step if falsy', async () => {
    const workflow: WorkflowDefinition = {
      id: 'when-test',
      steps: [
        { id: 'a', skillId: 'echo', message: 'done' },
        { id: 'b', skillId: 'echo', message: 'skip-me', dependsOn: ['a'], when: '' },
      ],
    };
    const result = await executeWorkflow(workflow, dispatch);
    expect(result.steps.find(s => s.stepId === 'b')?.status).toBe('skipped');
  });
});
