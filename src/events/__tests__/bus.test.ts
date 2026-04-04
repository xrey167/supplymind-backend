import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('topic matching', () => {
    test('exact match', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.shell.completed', (e) => { received.push(e.data); });
      await bus.publish('agent.shell.completed', { ok: true });
      expect(received).toEqual([{ ok: true }]);
    });

    test('* matches one segment', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.*.completed', (e) => { received.push(e.data); });
      await bus.publish('agent.shell.completed', { tool: 'shell' });
      await bus.publish('agent.ai.completed', { tool: 'ai' });
      await bus.publish('agent.shell.failed', { tool: 'shell' });
      expect(received).toEqual([{ tool: 'shell' }, { tool: 'ai' }]);
    });

    test('# matches zero or more segments', async () => {
      const received: string[] = [];
      bus.subscribe('workflow.#', (e) => { received.push(e.topic); });
      await bus.publish('workflow', 'a');
      await bus.publish('workflow.step.1.done', 'b');
      await bus.publish('workflow.completed', 'c');
      expect(received).toEqual(['workflow', 'workflow.step.1.done', 'workflow.completed']);
    });

    test('no match for unrelated topic', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.*', (e) => { received.push(e); });
      await bus.publish('workflow.started', {});
      expect(received).toHaveLength(0);
    });
  });

  describe('event history', () => {
    test('stores published events', async () => {
      await bus.publish('test.a', 1);
      await bus.publish('test.b', 2);
      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].topic).toBe('test.a');
    });

    test('replay returns events matching pattern since timestamp', async () => {
      await bus.publish('agent.x', 'old');
      // Wait 2ms to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 2));
      const cutoff = new Date().toISOString();
      await bus.publish('agent.y', 'new');
      const replayed = bus.replay('agent.*', cutoff);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].data).toBe('new');
    });
  });

  describe('dead letter queue', () => {
    test('captures failed deliveries', async () => {
      bus.subscribe('fail.topic', () => { throw new Error('handler boom'); });
      await bus.publish('fail.topic', {});
      const dead = bus.getDeadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0].error).toBe('handler boom');
    });
  });

  describe('subscriber groups', () => {
    test('unsubscribeGroup removes all group subscriptions', async () => {
      const received: unknown[] = [];
      bus.subscribeWithGroup('myModule', 'test.*', (e) => { received.push(e.data); });
      bus.subscribeWithGroup('myModule', 'other.*', (e) => { received.push(e.data); });
      bus.unsubscribeGroup('myModule');
      await bus.publish('test.x', 1);
      await bus.publish('other.x', 2);
      expect(received).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    test('stops receiving events', async () => {
      const received: unknown[] = [];
      const id = bus.subscribe('test.x', (e) => { received.push(e.data); });
      await bus.publish('test.x', 1);
      bus.unsubscribe(id);
      await bus.publish('test.x', 2);
      expect(received).toEqual([1]);
    });
  });

  describe('subscription filters', () => {
    test('field-level filter restricts delivery', async () => {
      const received: unknown[] = [];
      bus.subscribe('task.*', (e) => { received.push(e.data); }, {
        filter: { 'data.status': 'completed' },
      });
      await bus.publish('task.update', { status: 'working' });
      await bus.publish('task.update', { status: 'completed' });
      expect(received).toEqual([{ status: 'completed' }]);
    });
  });

  describe('stats', () => {
    test('returns subscription and history counts', async () => {
      bus.subscribe('a.*', () => {});
      await bus.publish('a.b', 1);
      const stats = bus.getStats();
      expect(stats.subscriptions).toBe(1);
      expect(stats.historySize).toBe(1);
    });
  });
});
