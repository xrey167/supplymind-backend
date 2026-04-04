import { describe, test, expect } from 'bun:test';
import { collaborate } from '../collaboration.engine';
import type { CollabDispatchFn, CollaborationRequest } from '../collaboration.types';

const mockDispatch: CollabDispatchFn = async (skillId, args) => {
  return `Response from ${skillId}: ${JSON.stringify(args).slice(0, 50)}`;
};

describe('collaborate', () => {
  test('fan_out: queries all agents and concatenates results', async () => {
    const result = await collaborate({
      strategy: 'fan_out',
      query: 'What is 2+2?',
      agents: ['agent-a', 'agent-b'],
    }, mockDispatch);

    expect(result.strategy).toBe('fan_out');
    expect(result.responses).toHaveLength(2);
    expect(result.output).toContain('agent-a');
    expect(result.output).toContain('agent-b');
  });

  test('fan_out: handles agent errors gracefully', async () => {
    const failDispatch: CollabDispatchFn = async (skillId) => {
      if (skillId === 'agent-bad') throw new Error('agent down');
      return `ok from ${skillId}`;
    };
    const result = await collaborate({
      strategy: 'fan_out',
      query: 'test',
      agents: ['agent-good', 'agent-bad'],
    }, failDispatch);

    expect(result.responses.find(r => r.agent === 'agent-bad')?.error).toBe('agent down');
    expect(result.output).toContain('agent-good');
  });

  test('consensus: picks highest-scored response', async () => {
    let callCount = 0;
    const scoringDispatch: CollabDispatchFn = async (skillId, args) => {
      callCount++;
      if (skillId === 'agent-a') return 'Good answer';
      if (skillId === 'agent-b') return 'Great answer';
      return JSON.stringify({
        scores: [{ id: 0, score: 6, reason: 'ok' }, { id: 1, score: 9, reason: 'great' }],
        bestId: 1,
        agreement: 0.7,
      });
    };
    const result = await collaborate({
      strategy: 'consensus',
      query: 'Best approach?',
      agents: ['agent-a', 'agent-b'],
      judgeAgent: 'judge',
    }, scoringDispatch);

    expect(result.strategy).toBe('consensus');
    expect(result.output).toContain('Great answer');
  });

  test('map_reduce: distributes items and aggregates', async () => {
    const result = await collaborate({
      strategy: 'map_reduce',
      query: 'Analyze this item',
      agents: ['agent-a'],
      items: ['item1', 'item2', 'item3'],
    }, mockDispatch);

    expect(result.strategy).toBe('map_reduce');
    expect(result.responses.length).toBeGreaterThanOrEqual(3);
  });

  test('consensus: returns warning when all agents fail', async () => {
    const allFail: CollabDispatchFn = async () => { throw new Error('down'); };
    const result = await collaborate({
      strategy: 'consensus',
      query: 'test',
      agents: ['a', 'b'],
    }, allFail);

    expect(result.output).toBe('');
    expect(result.warning).toBe('All agents failed');
  });

  test('consensus: falls back to first when judge returns invalid JSON', async () => {
    const dispatch: CollabDispatchFn = async (skillId) => {
      if (skillId === 'judge') return 'not json at all';
      return `answer from ${skillId}`;
    };
    const result = await collaborate({
      strategy: 'consensus',
      query: 'test',
      agents: ['a', 'b'],
      judgeAgent: 'judge',
    }, dispatch);

    expect(result.output).toContain('answer from a');
  });

  test('debate: iterates rounds until convergence or max', async () => {
    const result = await collaborate({
      strategy: 'debate',
      query: 'Best solution?',
      agents: ['agent-a', 'agent-b'],
      maxRounds: 2,
    }, mockDispatch);

    expect(result.strategy).toBe('debate');
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds).toBeLessThanOrEqual(2);
  });
});
