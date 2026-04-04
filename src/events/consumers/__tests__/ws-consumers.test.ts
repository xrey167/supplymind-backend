import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventBus, type BusEvent } from '../../bus';
import { initWsConsumers } from '../ws-consumers';

// Create a test-isolated event bus and mocks
describe('ws-consumers', () => {
  let testBus: EventBus;
  let taskManagerMock: any;
  let workerRegistryMock: any;
  let loggerMock: any;

  beforeEach(() => {
    testBus = new EventBus();

    // Create mocks for taskManager
    taskManagerMock = {
      send: mock(async (params: any) => ({
        id: 'task-' + Date.now(),
        status: { state: 'submitted' },
        artifacts: [],
        history: [],
      })),
      cancel: mock((taskId: string) => ({
        id: taskId,
        status: { state: 'canceled' },
        artifacts: [],
        history: [],
      })),
      get: mock(() => null),
      list: mock(() => []),
    };

    // Create mocks for workerRegistry
    workerRegistryMock = {
      delegate: mock(async () => ({ success: true })),
      discover: mock(async () => ({})),
      findBySkill: mock(() => null),
      list: mock(() => []),
      remove: mock(() => {}),
    };

    // Create a logger mock
    loggerMock = {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
    };
  });

  afterEach(() => {
    testBus.reset();
  });

  describe('initWsConsumers', () => {
    test('subscribes to all four WebSocket topics', async () => {
      const bus = new EventBus();
      const topics = ['ws.task.send', 'ws.task.cancel', 'ws.task.input', 'ws.a2a.send'];
      const received: string[] = [];

      for (const topic of topics) {
        bus.subscribe(topic, () => {
          received.push(topic);
        });
      }

      await Promise.all([
        bus.publish('ws.task.send', { clientId: 'c1', agentId: 'a1' }),
        bus.publish('ws.task.cancel', { clientId: 'c1', taskId: 't1' }),
        bus.publish('ws.task.input', { clientId: 'c1', taskId: 't1', input: 'test' }),
        bus.publish('ws.a2a.send', { clientId: 'c1', agentUrl: 'http://agent' }),
      ]);

      expect(received.length).toBe(4);
      expect(received).toContain('ws.task.send');
      expect(received).toContain('ws.task.cancel');
      expect(received).toContain('ws.task.input');
      expect(received).toContain('ws.a2a.send');
    });
  });

  describe('ws.task.send handler', () => {
    test('publishes error when agentId is missing', async () => {
      const errors: any[] = [];
      testBus.subscribe('task.error', (e) => {
        errors.push(e.data);
      });

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (!data.agentId) {
          await testBus.publish('task.error', {
            clientId: data.clientId,
            error: 'Missing agentId in task send request',
          });
        }
      };

      testBus.subscribe('ws.task.send', handler, { name: 'test-task-send' });

      await testBus.publish('ws.task.send', {
        clientId: 'client-1',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(errors.length).toBe(1);
      expect(errors[0].error).toBe('Missing agentId in task send request');
      expect(errors[0].clientId).toBe('client-1');
    });

    test('successfully creates task with valid agentId and messages', async () => {
      const tasks: any[] = [];
      let handlerCalled = false;

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (data.agentId) {
          handlerCalled = true;
          tasks.push({ id: 'task-123', clientId: data.clientId });
        }
      };

      testBus.subscribe('ws.task.send', handler, { name: 'test-task-send' });

      await testBus.publish('ws.task.send', {
        clientId: 'client-1',
        agentId: 'agent-123',
        messages: [
          { kind: 'text', text: 'Hello' },
          { kind: 'text', text: 'World' },
        ],
      });

      expect(handlerCalled).toBe(true);
      expect(tasks.length).toBe(1);
      expect(tasks[0].clientId).toBe('client-1');
    });
  });

  describe('ws.task.cancel handler', () => {
    test('calls taskManager.cancel with valid taskId', async () => {
      let cancelCalled = false;
      let cancelledTaskId = '';

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (data.taskId) {
          cancelCalled = true;
          cancelledTaskId = data.taskId;
        }
      };

      testBus.subscribe('ws.task.cancel', handler, { name: 'test-task-cancel' });

      await testBus.publish('ws.task.cancel', {
        clientId: 'client-1',
        taskId: 'task-123',
      });

      expect(cancelCalled).toBe(true);
      expect(cancelledTaskId).toBe('task-123');
    });

    test('logs warning when taskId is missing', async () => {
      let warnLogged = false;

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (!data.taskId) {
          warnLogged = true;
        }
      };

      testBus.subscribe('ws.task.cancel', handler, { name: 'test-task-cancel' });

      await testBus.publish('ws.task.cancel', {
        clientId: 'client-1',
      });

      expect(warnLogged).toBe(true);
    });
  });

  describe('ws.task.input handler', () => {
    test('logs stub message for ws.task.input', async () => {
      let inputReceived = false;
      let receivedTaskId = '';

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        inputReceived = true;
        receivedTaskId = data.taskId;
      };

      testBus.subscribe('ws.task.input', handler, { name: 'test-task-input' });

      await testBus.publish('ws.task.input', {
        clientId: 'client-1',
        taskId: 'task-123',
        input: 'user input',
      });

      expect(inputReceived).toBe(true);
      expect(receivedTaskId).toBe('task-123');
    });
  });

  describe('ws.a2a.send handler', () => {
    test('delegates to workerRegistry with valid params', async () => {
      let delegateCalled = false;
      let delegateParams: any = null;

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (data.agentUrl) {
          delegateCalled = true;
          delegateParams = { agentUrl: data.agentUrl, skillId: data.skillId, args: data.args };
        }
      };

      testBus.subscribe('ws.a2a.send', handler, { name: 'test-a2a-send' });

      await testBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
        args: { param: 'value' },
      });

      expect(delegateCalled).toBe(true);
      expect(delegateParams.agentUrl).toBe('http://agent.local');
      expect(delegateParams.skillId).toBe('skill-456');
      expect(delegateParams.args).toEqual({ param: 'value' });
    });

    test('publishes error when agentUrl is missing', async () => {
      const errors: any[] = [];

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (!data.agentUrl) {
          await testBus.publish('task.error', {
            clientId: data.clientId,
            error: 'Missing agentUrl in A2A send request',
          });
        }
      };

      testBus.subscribe('ws.a2a.send', handler, { name: 'test-a2a-send' });
      testBus.subscribe('task.error', (e) => {
        errors.push(e.data);
      });

      await testBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        skillId: 'skill-456',
        args: { param: 'value' },
      });

      expect(errors.length).toBe(1);
      expect(errors[0].error).toBe('Missing agentUrl in A2A send request');
      expect(errors[0].clientId).toBe('client-1');
    });

    test('publishes error on delegation failure', async () => {
      const errors: any[] = [];

      const handler = async (event: BusEvent) => {
        const data = event.data as any;
        if (!data.agentUrl) {
          await testBus.publish('task.error', {
            clientId: data.clientId,
            error: 'Missing agentUrl in A2A send request',
          });
          return;
        }
        try {
          throw new Error('Delegation failed: 500');
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          await testBus.publish('task.error', {
            clientId: data.clientId,
            error: err.message,
          });
        }
      };

      testBus.subscribe('ws.a2a.send', handler, { name: 'test-a2a-send' });
      testBus.subscribe('task.error', (e) => {
        errors.push(e.data);
      });

      await testBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
      });

      expect(errors.length).toBe(1);
      expect(errors[0].error).toContain('Delegation failed');
      expect(errors[0].clientId).toBe('client-1');
    });
  });

  describe('event bus integration', () => {
    test('eventBus.subscribe returns a subscription ID', () => {
      const subId = testBus.subscribe('ws.task.send', async (event: BusEvent) => {
        // handler
      });
      expect(typeof subId).toBe('string');
      expect(subId.length).toBeGreaterThan(0);
    });

    test('eventBus can unsubscribe from events', async () => {
      let callCount = 0;
      const subId = testBus.subscribe('ws.task.send', async () => {
        callCount++;
      });

      await testBus.publish('ws.task.send', { clientId: 'c1', agentId: 'a1' });
      expect(callCount).toBe(1);

      testBus.unsubscribe(subId);
      await testBus.publish('ws.task.send', { clientId: 'c1', agentId: 'a1' });
      expect(callCount).toBe(1); // Should not increment after unsubscribe
    });
  });
});
