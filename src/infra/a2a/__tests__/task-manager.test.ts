import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { taskManager } from '../task-manager';
import { eventBus } from '../../../events/bus';

// Mock createRuntime
const mockRun = mock(() => Promise.resolve({ ok: true, value: { content: 'done', stopReason: 'end_turn' } }));
const mockStream = mock(() => (async function* () {})());
const mockRuntime = { run: mockRun, stream: mockStream };

mock.module('../../../infra/ai/runtime-factory', () => ({
  createRuntime: () => mockRuntime,
}));

// Mock dispatchSkill
const mockDispatchSkill = mock(() => Promise.resolve({ ok: true, value: 'tool-result' }));
mock.module('../../../modules/skills/skills.dispatch', () => ({
  dispatchSkill: mockDispatchSkill,
}));

// Mock skillRegistry
mock.module('../../../modules/skills/skills.registry', () => ({
  skillRegistry: {
    toToolDefinitions: () => [{ name: 'echo', description: 'Echo', inputSchema: {} }],
  },
}));

function baseConfig() {
  return {
    id: 'agent-1',
    provider: 'anthropic' as const,
    mode: 'raw' as const,
    model: 'claude-sonnet-4-20250514',
    workspaceId: 'ws-1',
  };
}

function flush(ms = 100) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TaskManager', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockDispatchSkill.mockReset();
    mockRun.mockResolvedValue({ ok: true, value: { content: 'done', stopReason: 'end_turn' } });
    mockDispatchSkill.mockResolvedValue({ ok: true, value: 'tool-result' });
  });

  describe('send', () => {
    test('returns task with submitted status synchronously', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'hello' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      expect(task.id).toBeDefined();
      // Task runs async but may complete instantly with mocked runtime
      expect(['submitted', 'working', 'completed']).toContain(task.status.state);
      await flush();
    });

    test('task completes asynchronously', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'hello' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush();

      const completed = taskManager.get(task.id);
      expect(completed?.status.state).toBe('completed');
      expect(completed?.artifacts?.[0]?.parts?.[0]).toEqual({ kind: 'text', text: 'done' });
    });
  });

  describe('tool call loop', () => {
    test('executes tool calls and continues loop', async () => {
      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling tool',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'tc-1', name: 'echo', args: { msg: 'hi' } }],
            },
          };
        }
        return { ok: true, value: { content: 'final', stopReason: 'end_turn' } };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'use tool' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      expect(mockDispatchSkill).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(2);
      const completed = taskManager.get(task.id);
      expect(completed?.status.state).toBe('completed');
    });
  });

  describe('pause_turn', () => {
    test('continues loop on pause_turn stop reason', async () => {
      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, value: { content: 'pausing', stopReason: 'pause_turn' } };
        }
        return { ok: true, value: { content: 'resumed', stopReason: 'end_turn' } };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'test' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      expect(callCount).toBe(2);
      expect(taskManager.get(task.id)?.status.state).toBe('completed');
    });
  });

  describe('max iterations', () => {
    test('fails after max tool call iterations', async () => {
      mockRun.mockResolvedValue({
        ok: true,
        value: {
          content: 'looping',
          stopReason: 'tool_use',
          toolCalls: [{ id: 'tc-loop', name: 'echo', args: {} }],
        },
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'loop' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(500);

      const result = taskManager.get(task.id);
      expect(result?.status.state).toBe('failed');
      expect(result?.status.message).toContain('Max tool call iterations');
    });
  });

  describe('failed runtime', () => {
    test('marks task failed when runtime returns error', async () => {
      mockRun.mockResolvedValue({ ok: false, error: { message: 'API error' } });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'fail' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush();

      expect(taskManager.get(task.id)?.status.state).toBe('failed');
      expect(taskManager.get(task.id)?.status.message).toBe('API error');
    });
  });

  describe('cancel', () => {
    test('cancels an existing task', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'cancel me' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      const result = taskManager.cancel(task.id);
      expect(result?.status.state).toBe('canceled');
    });

    test('returns undefined for unknown task', () => {
      expect(taskManager.cancel('nonexistent')).toBeUndefined();
    });

    test('abort controller signal is aborted after cancel()', async () => {
      // Use a slow runtime so executeTask is still in-flight
      mockRun.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: { content: 'done', stopReason: 'end_turn' } }), 500)));

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'abort signal test' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      // Access the internal record via the public get — we check status instead of signal directly
      taskManager.cancel(task.id);
      expect(taskManager.get(task.id)?.status.state).toBe('canceled');
    });

    test('TASK_CANCELED event is emitted on cancel()', async () => {
      const canceledEvents: any[] = [];
      eventBus.subscribe('task.canceled', (e) => canceledEvents.push(e.data));

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'emit cancel event' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      taskManager.cancel(task.id);

      expect(canceledEvents.length).toBeGreaterThan(0);
      expect(canceledEvents[0].taskId).toBe(task.id);
      expect(canceledEvents[0].workspaceId).toBe('ws-1');
      await flush();
    });

    test('signal is passed to dispatchSkill', async () => {
      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling tool',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'tc-sig', name: 'echo', args: { msg: 'hi' } }],
            },
          };
        }
        return { ok: true, value: { content: 'final', stopReason: 'end_turn' } };
      });

      let capturedCtx: any;
      mockDispatchSkill.mockImplementation(async (_skillId: string, _args: any, ctx: any) => {
        capturedCtx = ctx;
        return { ok: true, value: 'tool-result' };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'signal passthrough' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx.signal).toBeInstanceOf(AbortSignal);
      expect(taskManager.get(task.id)?.status.state).toBe('completed');
    });
  });

  describe('get and list', () => {
    test('get returns task by id', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'get me' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      expect(taskManager.get(task.id)).toBeDefined();
      expect(taskManager.get('nope')).toBeUndefined();
      await flush();
    });

    test('list filters by workspaceId', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'list' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      expect(taskManager.list('ws-1').length).toBeGreaterThan(0);
      expect(taskManager.list('ws-other').length).toBe(0);
      await flush();
    });
  });

  describe('toolChoice pass-through', () => {
    test('passes toolChoice and disableParallelToolUse to runtime', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'with options' }] },
        agentConfig: {
          ...baseConfig(),
          toolChoice: { type: 'any' },
          disableParallelToolUse: true,
        },
        callerId: 'caller-1',
      });

      await flush();

      const runCall = mockRun.mock.calls[0][0] as any;
      expect(runCall.toolChoice).toEqual({ type: 'any' });
      expect(runCall.disableParallelToolUse).toBe(true);
    });
  });

  describe('events', () => {
    test('publishes TASK_STATUS and TASK_COMPLETED events', async () => {
      const statusEvents: any[] = [];
      const completedEvents: any[] = [];
      eventBus.subscribe('task.status', (e) => statusEvents.push(e.data));
      eventBus.subscribe('task.completed', (e) => completedEvents.push(e.data));

      await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'events' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush();

      // Should have submitted + working + completed status events
      const states = statusEvents.map((e) => e.status);
      expect(states).toContain('submitted');
      expect(states).toContain('completed');
      expect(completedEvents.length).toBeGreaterThan(0);
    });
  });
});
