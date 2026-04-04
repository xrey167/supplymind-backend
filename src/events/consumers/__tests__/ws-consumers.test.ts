import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { eventBus } from '../../bus';
import { taskManager } from '../../../infra/a2a/task-manager';
import { workerRegistry } from '../../../infra/a2a/worker-registry';
import { initWsConsumers } from '../ws-consumers';

describe('ws-consumers', () => {
  beforeEach(() => {
    eventBus.reset();
    initWsConsumers();
  });

  describe('ws.task.send', () => {
    test('creates task via taskManager with valid agentId', async () => {
      const sendSpy = spyOn(taskManager, 'send').mockResolvedValue({
        id: 'task-123',
        status: { state: 'submitted' },
        artifacts: [],
        history: [],
      } as any);

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        agentId: 'agent-123',
        messages: [{ kind: 'text', text: 'Hello' }],
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(sendSpy).toHaveBeenCalled();
      const call = sendSpy.mock.calls[0][0] as any;
      expect(call.agentConfig.id).toBe('agent-123');
      expect(call.callerId).toBe('client-1');
      sendSpy.mockRestore();
    });

    test('publishes error event when agentId is missing', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => { errorEvents.push(e.data); });

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        messages: [{ kind: 'text', text: 'Hello' }],
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('agentId');
    });

    test('publishes error when taskManager.send throws', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => { errorEvents.push(e.data); });

      const sendSpy = spyOn(taskManager, 'send').mockRejectedValue(new Error('Task creation failed'));

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        agentId: 'agent-123',
        messages: [{ kind: 'text', text: 'Hello' }],
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('Task creation failed');
      sendSpy.mockRestore();
    });
  });

  describe('ws.task.cancel', () => {
    test('calls taskManager.cancel with valid taskId', async () => {
      const cancelSpy = spyOn(taskManager, 'cancel').mockReturnValue({
        id: 'task-123',
        status: { state: 'canceled' },
        artifacts: [],
        history: [],
      } as any);

      await eventBus.publish('ws.task.cancel', {
        clientId: 'client-1',
        taskId: 'task-123',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(cancelSpy).toHaveBeenCalledWith('task-123');
      cancelSpy.mockRestore();
    });

    test('handles missing taskId gracefully', async () => {
      const cancelSpy = spyOn(taskManager, 'cancel');

      await eventBus.publish('ws.task.cancel', { clientId: 'client-1' });
      await new Promise((r) => setTimeout(r, 50));

      expect(cancelSpy).not.toHaveBeenCalled();
      cancelSpy.mockRestore();
    });
  });

  describe('ws.task.input', () => {
    test('does not crash for unimplemented input handler', async () => {
      await eventBus.publish('ws.task.input', {
        clientId: 'client-1',
        taskId: 'task-123',
        input: 'user input',
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(true).toBe(true);
    });
  });

  describe('ws.a2a.send', () => {
    test('delegates to workerRegistry with valid params', async () => {
      const delegateSpy = spyOn(workerRegistry, 'delegate').mockResolvedValue({ success: true });

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
        args: { param: 'value' },
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(delegateSpy).toHaveBeenCalled();
      expect(delegateSpy.mock.calls[0][0]).toBe('http://agent.local');
      delegateSpy.mockRestore();
    });

    test('publishes error when agentUrl is missing', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => { errorEvents.push(e.data); });

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        skillId: 'skill-456',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('agentUrl');
    });

    test('publishes error when workerRegistry.delegate throws', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => { errorEvents.push(e.data); });

      const delegateSpy = spyOn(workerRegistry, 'delegate').mockRejectedValue(new Error('Delegation failed'));

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('Delegation failed');
      delegateSpy.mockRestore();
    });
  });

  describe('ws.skill.invoke', () => {
    test('successful skill invocation publishes ws.skill.result', async () => {
      const { dispatchSkill } = await import('../../../modules/skills/skills.dispatch');
      const dispatchSpy = spyOn({ dispatchSkill } as any, 'dispatchSkill');

      // We need to mock at the module level — use eventBus directly
      const resultEvents: any[] = [];
      eventBus.subscribe('ws.skill.result', (e) => { resultEvents.push(e.data); });

      // Mock dispatchSkill via module mock
      const originalModule = await import('../../../modules/skills/skills.dispatch');
      const spy = spyOn(originalModule, 'dispatchSkill' as any).mockResolvedValue({ ok: true, value: { echo: 'hello' } });

      await eventBus.publish('ws.skill.invoke', {
        clientId: 'client-1',
        name: 'echo',
        args: { msg: 'hello' },
        requestId: 'req-1',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(resultEvents.length).toBeGreaterThan(0);
      const msg = resultEvents[0].message;
      expect(msg.type).toBe('skill:result');
      expect(msg.name).toBe('echo');
      expect(msg.ok).toBe(true);
      expect(msg.requestId).toBe('req-1');
      spy.mockRestore();
      dispatchSpy.mockRestore();
    });

    test('publishes error result when skill name is missing', async () => {
      const resultEvents: any[] = [];
      eventBus.subscribe('ws.skill.result', (e) => { resultEvents.push(e.data); });

      await eventBus.publish('ws.skill.invoke', {
        clientId: 'client-1',
        requestId: 'req-2',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(resultEvents.length).toBeGreaterThan(0);
      const msg = resultEvents[0].message;
      expect(msg.ok).toBe(false);
      expect(msg.error).toContain('Missing skill name');
    });

    test('publishes error result when dispatchSkill throws', async () => {
      const resultEvents: any[] = [];
      eventBus.subscribe('ws.skill.result', (e) => { resultEvents.push(e.data); });

      const originalModule = await import('../../../modules/skills/skills.dispatch');
      const spy = spyOn(originalModule, 'dispatchSkill' as any).mockRejectedValue(new Error('Skill exploded'));

      await eventBus.publish('ws.skill.invoke', {
        clientId: 'client-1',
        name: 'broken-skill',
        args: {},
        requestId: 'req-3',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(resultEvents.length).toBeGreaterThan(0);
      const msg = resultEvents[0].message;
      expect(msg.ok).toBe(false);
      expect(msg.error).toContain('Skill exploded');
      expect(msg.name).toBe('broken-skill');
      spy.mockRestore();
    });
  });

  describe('subscriber initialization', () => {
    test('initWsConsumers subscribes to all topics', () => {
      eventBus.reset();
      const before = eventBus.getStats().subscriptions;
      initWsConsumers();
      expect(eventBus.getStats().subscriptions).toBe(before + 8);
    });
  });
});
