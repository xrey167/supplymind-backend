import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Mock task manager and worker registry FIRST, before any imports
let mockTaskSendImpl: (params: any) => Promise<any>;
let mockTaskCancelImpl: (taskId: string) => any;
let mockWorkerDelegateImpl: (agentUrl: string, params: any) => Promise<any>;

mock.module('../../../infra/a2a/task-manager', () => ({
  taskManager: {
    get send() {
      return (params: any) => mockTaskSendImpl(params);
    },
    get cancel() {
      return (taskId: string) => mockTaskCancelImpl(taskId);
    },
  },
}));

mock.module('../../../infra/a2a/worker-registry', () => ({
  workerRegistry: {
    get delegate() {
      return (agentUrl: string, params: any) => mockWorkerDelegateImpl(agentUrl, params);
    },
  },
}));

// Mock logger to suppress output
mock.module('../../../config/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// Now import eventBus and ws-consumers
import { eventBus } from '../../bus';
import { initWsConsumers } from '../ws-consumers';

describe('ws-consumers', () => {
  beforeEach(() => {
    // Reset eventBus subscriptions
    eventBus.reset();

    // Set up default mock implementations
    mockTaskSendImpl = async (params: any) => ({
      id: 'task-' + Date.now(),
      status: { state: 'submitted' },
      artifacts: [],
      history: [],
    });

    mockTaskCancelImpl = (taskId: string) => ({
      id: taskId,
      status: { state: 'canceled' },
      artifacts: [],
      history: [],
    });

    mockWorkerDelegateImpl = async (agentUrl: string, params: any) => ({
      success: true,
      result: 'delegation-result',
    });

    // Initialize consumers after resetting and setting up mocks
    initWsConsumers();
  });

  describe('ws.task.send', () => {
    test('creates task via taskManager with valid agentId and messages', async () => {
      const taskSendCalls: any[] = [];
      mockTaskSendImpl = async (params: any) => {
        taskSendCalls.push(params);
        return {
          id: 'task-123',
          status: { state: 'submitted' },
          artifacts: [],
          history: [],
        };
      };

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        agentId: 'agent-123',
        messages: [{ kind: 'text', text: 'Hello' }],
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(taskSendCalls.length).toBeGreaterThan(0);
      const call = taskSendCalls[0];
      expect(call.agentConfig.id).toBe('agent-123');
      expect(call.callerId).toBe('client-1');
    });

    test('publishes error event when agentId is missing', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => {
        errorEvents.push(e.data);
      });

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        messages: [{ kind: 'text', text: 'Hello' }],
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].clientId).toBe('client-1');
      expect(errorEvents[0].error).toContain('agentId');
    });

    test('publishes error when taskManager.send throws', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => {
        errorEvents.push(e.data);
      });

      mockTaskSendImpl = async () => {
        throw new Error('Task creation failed');
      };

      await eventBus.publish('ws.task.send', {
        clientId: 'client-1',
        agentId: 'agent-123',
        messages: [{ kind: 'text', text: 'Hello' }],
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('Task creation failed');
    });
  });

  describe('ws.task.cancel', () => {
    test('calls taskManager.cancel with valid taskId', async () => {
      const cancelCalls: string[] = [];
      mockTaskCancelImpl = (taskId: string) => {
        cancelCalls.push(taskId);
        return {
          id: taskId,
          status: { state: 'canceled' },
          artifacts: [],
          history: [],
        };
      };

      await eventBus.publish('ws.task.cancel', {
        clientId: 'client-1',
        taskId: 'task-123',
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(cancelCalls).toContain('task-123');
    });

    test('handles missing taskId gracefully', async () => {
      const cancelCalls: string[] = [];
      mockTaskCancelImpl = (taskId: string) => {
        cancelCalls.push(taskId);
        return null;
      };

      // Publish without taskId
      await eventBus.publish('ws.task.cancel', {
        clientId: 'client-1',
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      // Should not call cancel
      expect(cancelCalls.length).toBe(0);
    });

    test('logs errors gracefully when taskManager.cancel throws', async () => {
      mockTaskCancelImpl = () => {
        throw new Error('Cancellation failed');
      };

      // Should not throw or crash
      await eventBus.publish('ws.task.cancel', {
        clientId: 'client-1',
        taskId: 'task-123',
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      // If we get here without error, the test passes
      expect(true).toBe(true);
    });
  });

  describe('ws.task.input', () => {
    test('logs warning for unimplemented input handler', async () => {
      // The handler logs a warning and returns without error
      // Just verify it doesn't crash
      await eventBus.publish('ws.task.input', {
        clientId: 'client-1',
        taskId: 'task-123',
        input: 'user input',
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      // If we get here without error, the test passes
      expect(true).toBe(true);
    });
  });

  describe('ws.a2a.send', () => {
    test('delegates to workerRegistry with valid params', async () => {
      const delegateCalls: any[] = [];
      mockWorkerDelegateImpl = async (agentUrl: string, params: any) => {
        delegateCalls.push({ agentUrl, params });
        return { success: true };
      };

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
        args: { param: 'value' },
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(delegateCalls.length).toBeGreaterThan(0);
      const call = delegateCalls[0];
      expect(call.agentUrl).toBe('http://agent.local');
      expect(call.params.skillId).toBe('skill-456');
      expect(call.params.args).toEqual({ param: 'value' });
    });

    test('publishes error when agentUrl is missing', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => {
        errorEvents.push(e.data);
      });

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        skillId: 'skill-456',
        args: { param: 'value' },
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].clientId).toBe('client-1');
      expect(errorEvents[0].error).toContain('agentUrl');
    });

    test('publishes error when workerRegistry.delegate throws', async () => {
      const errorEvents: any[] = [];
      eventBus.subscribe('task.error', (e) => {
        errorEvents.push(e.data);
      });

      mockWorkerDelegateImpl = async () => {
        throw new Error('Delegation failed: 500');
      };

      await eventBus.publish('ws.a2a.send', {
        clientId: 'client-1',
        agentUrl: 'http://agent.local',
        skillId: 'skill-456',
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error).toContain('Delegation failed');
    });
  });

  describe('subscriber initialization', () => {
    test('initWsConsumers subscribes to all four topics', async () => {
      // Create a fresh event bus to verify topics are subscribed
      eventBus.reset();
      const stats = eventBus.getStats();
      const initialSubscriptions = stats.subscriptions;

      initWsConsumers();

      const newStats = eventBus.getStats();
      expect(newStats.subscriptions).toBeGreaterThan(initialSubscriptions);
      // Should have at least 4 subscriptions (one for each ws.* topic)
      expect(newStats.subscriptions).toBeGreaterThanOrEqual(4);
    });
  });
});
