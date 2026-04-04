import { describe, test, expect } from 'bun:test';
import { EventBus } from '../events/bus';
import { RedisPubSub } from '../infra/redis/pubsub';
import { collaborate } from '../modules/collaboration/collaboration.engine';
import { executeWorkflow } from '../modules/workflows/workflows.engine';
import { compose, executePipeline } from '../modules/skills/skills.composer';

describe('Integration', () => {
  test('event bus → redis bridge → collaboration', async () => {
    const bus = new EventBus();
    const published: string[] = [];
    const mockRedis = {
      publish: async (_c: string, m: string) => {
        published.push(m);
        return 1;
      },
    };
    const pubsub = new RedisPubSub(bus, mockRedis);
    pubsub.bridgeToRedis('collaboration.#');

    const dispatch = async (_skillId: string, _args: Record<string, unknown>) =>
      `${_skillId} says hello`;
    const result = await collaborate(
      {
        strategy: 'fan_out',
        query: 'test',
        agents: ['a', 'b'],
      },
      dispatch,
    );

    await bus.publish('collaboration.completed', {
      id: result.id,
      output: result.output,
    });
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]).data.id).toBe(result.id);
  });

  test('workflow engine chains skills with template substitution', async () => {
    const dispatch = async (
      skillId: string,
      _args: Record<string, unknown>,
      text: string,
    ) => {
      if (skillId === 'greet') return `Hello ${text}`;
      if (skillId === 'upper') return text.toUpperCase();
      return text;
    };
    const result = await executeWorkflow(
      {
        id: 'greet-flow',
        steps: [
          { id: 'greet', skillId: 'greet', message: 'World' },
          {
            id: 'shout',
            skillId: 'upper',
            message: '{{greet.result}}',
            dependsOn: ['greet'],
          },
        ],
      },
      dispatch,
    );

    expect(result.status).toBe('completed');
    expect(result.steps[1].result).toBe('HELLO WORLD');
  });

  test('skill composer pipeline with fallback', async () => {
    const dispatch = async (
      skillId: string,
      _args: Record<string, unknown>,
      text: string,
    ) => {
      if (skillId === 'fail') throw new Error('down');
      return `${skillId}(${text})`;
    };
    const pipeline = compose('resilient', [
      { skillId: 'fail', transform: 'x', onError: { fallback: 'safe' } },
      { skillId: 'wrap', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('wrap(safe)');
  });
});
