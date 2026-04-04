import { describe, test, expect } from 'bun:test';
import { compose, executePipeline } from '../skills.composer';
import type { PipelineDispatchFn } from '../skills.composer.types';

const dispatch: PipelineDispatchFn = async (skillId, args, text) => {
  if (skillId === 'upper') return (text || '').toUpperCase();
  if (skillId === 'wrap') return `[${text || JSON.stringify(args)}]`;
  if (skillId === 'fail') throw new Error('fail');
  return `${skillId}:${text}`;
};

describe('Skill Composer', () => {
  test('compose creates a pipeline', () => {
    const pipeline = compose('test', [{ skillId: 'echo' }]);
    expect(pipeline.name).toBe('test');
    expect(pipeline.steps).toHaveLength(1);
  });

  test('executePipeline chains step outputs', async () => {
    const pipeline = compose('chain', [
      { skillId: 'echo', transform: 'hello' },
      { skillId: 'upper', transform: '{{prev.result}}' },
      { skillId: 'wrap', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('[ECHO:HELLO]');
  });

  test('abort on error stops pipeline', async () => {
    const pipeline = compose('abort', [
      { skillId: 'echo', transform: 'ok' },
      { skillId: 'fail', transform: 'x', onError: 'abort' },
      { skillId: 'echo', transform: 'never' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('failed');
    expect(result.stepResults).toHaveLength(2);
  });

  test('skip on error continues pipeline', async () => {
    const pipeline = compose('skip', [
      { skillId: 'fail', transform: 'x', onError: 'skip' },
      { skillId: 'echo', transform: 'after' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('partial');
    expect(result.stepResults[0].status).toBe('skipped');
    expect(result.stepResults[1].status).toBe('completed');
  });

  test('fallback on error uses fallback value', async () => {
    const pipeline = compose('fallback', [
      { skillId: 'fail', transform: 'x', onError: { fallback: 'default' } },
      { skillId: 'upper', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('DEFAULT');
  });

  test('{{input.*}} resolves from initial input', async () => {
    const pipeline = compose('input', [
      { skillId: 'echo', transform: '{{input.name}}' },
    ]);
    const result = await executePipeline(pipeline, { name: 'world' }, dispatch);
    expect(result.output).toBe('echo:world');
  });
});
