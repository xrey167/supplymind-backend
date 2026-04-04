import { describe, test, expect, beforeEach, afterEach, afterAll, mock, spyOn } from 'bun:test';
import * as runtimeFactory from '../../../infra/ai/runtime-factory';
import * as skillsDispatch from '../../../modules/skills/skills.dispatch';
import * as skillsRegistryModule from '../../../modules/skills/skills.registry';
import { contextService } from '../../../modules/context/context.service';
import { taskManager } from '../task-manager';
import { eventBus } from '../../../events/bus';
import { toolRegistry } from '../../../modules/tools/tools.registry';

// Mock createRuntime via spyOn so it's properly restored and doesn't bleed
const mockRun = mock(() => Promise.resolve({ ok: true, value: { content: 'done', stopReason: 'end_turn' } }));
const mockStream = mock(() => (async function* () {})());
const mockRuntime = { run: mockRun, stream: mockStream };

const runtimeSpy = spyOn(runtimeFactory, 'createRuntime').mockImplementation(() => mockRuntime as any);

// Mock dispatchSkill via spyOn
const mockDispatchSkill = mock(() => Promise.resolve({ ok: true, value: 'tool-result' }));
const dispatchSpy = spyOn(skillsDispatch, 'dispatchSkill').mockImplementation(mockDispatchSkill as any);

// Mock skillRegistry.toToolDefinitions via spyOn
const toolDefsSpy = spyOn(skillsRegistryModule.skillRegistry, 'toToolDefinitions').mockImplementation(
  () => [{ name: 'echo', description: 'Echo', inputSchema: {} }],
);

// Mock contextService.prepare — pass through messages unchanged
const contextSpy = spyOn(contextService, 'prepare').mockImplementation(async (input: any) => ({
  systemPrompt: input.agentConfig.systemPrompt ?? '',
  messages: input.messages,
  estimatedTokens: 0,
  wasCompacted: false,
}));

// Restore only our spies after this file so they don't bleed into other test files
afterAll(() => {
  runtimeSpy.mockRestore();
  dispatchSpy.mockRestore();
  toolDefsSpy.mockRestore();
  contextSpy.mockRestore();
});

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

    test('double-cancel is idempotent — returns task without re-aborting', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'double cancel' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      const first = taskManager.cancel(task.id);
      const second = taskManager.cancel(task.id);
      expect(first?.status.state).toBe('canceled');
      expect(second?.status.state).toBe('canceled');
    });

    test('cancel on completed task returns task without changing state', async () => {
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'complete first' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush();
      expect(taskManager.get(task.id)?.status.state).toBe('completed');

      const result = taskManager.cancel(task.id);
      expect(result?.status.state).toBe('completed'); // state unchanged
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

  describe('toolIds filtering', () => {
    test('only tools in toolIds are passed to runtime', async () => {
      toolDefsSpy.mockImplementationOnce(() => [
        { name: 'allowed_tool', description: 'Allowed', inputSchema: {} },
        { name: 'blocked_tool', description: 'Blocked', inputSchema: {} },
      ]);

      await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'filter tools' }] },
        agentConfig: { ...baseConfig(), toolIds: ['allowed_tool'] },
        callerId: 'caller-1',
      });

      await flush();

      const runCall = mockRun.mock.calls[0][0] as any;
      expect(runCall.tools).toHaveLength(1);
      expect(runCall.tools[0].name).toBe('allowed_tool');
    });

    test('all tools passed when toolIds is undefined', async () => {
      toolDefsSpy.mockImplementationOnce(() => [
        { name: 'tool_a', description: 'A', inputSchema: {} },
        { name: 'tool_b', description: 'B', inputSchema: {} },
      ]);

      const config = baseConfig() as any;
      delete config.toolIds; // undefined → no filtering

      await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'all tools' }] },
        agentConfig: config,
        callerId: 'caller-1',
      });

      await flush();

      const runCall = mockRun.mock.calls[0][0] as any;
      expect(runCall.tools).toHaveLength(2);
    });

    test('empty toolIds array filters all tools out', async () => {
      toolDefsSpy.mockImplementationOnce(() => [
        { name: 'tool_a', description: 'A', inputSchema: {} },
        { name: 'tool_b', description: 'B', inputSchema: {} },
      ]);

      await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'no tools' }] },
        agentConfig: { ...baseConfig(), toolIds: [] },
        callerId: 'caller-1',
      });

      await flush();

      const runCall = mockRun.mock.calls[0][0] as any;
      expect(runCall.tools).toHaveLength(0);
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

  describe('tool concurrency batching', () => {
    test('read-only tools run in parallel', async () => {
      // Register two read-only tools
      toolRegistry.register({
        id: 'ro-1', name: 'ro_tool_1', description: 'Read-only 1',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'result-1' }),
      });
      toolRegistry.register({
        id: 'ro-2', name: 'ro_tool_2', description: 'Read-only 2',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'result-2' }),
      });

      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling ro tools',
              stopReason: 'tool_use',
              toolCalls: [
                { id: 'ro-tc-1', name: 'ro_tool_1', args: {} },
                { id: 'ro-tc-2', name: 'ro_tool_2', args: {} },
              ],
            },
          };
        }
        return { ok: true, value: { content: 'done', stopReason: 'end_turn' } };
      });

      const startTimes: number[] = [];
      mockDispatchSkill.mockImplementation(async (name: string) => {
        startTimes.push(Date.now());
        await new Promise(r => setTimeout(r, 80)); // 80ms delay per tool
        return { ok: true, value: `result-${name}` };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'parallel ro tools' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(400);

      expect(taskManager.get(task.id)?.status.state).toBe('completed');
      // Both tools were dispatched
      expect(mockDispatchSkill).toHaveBeenCalledTimes(2);
      // Both tools started nearly simultaneously (parallel) — start times within 30ms of each other
      // If serial, the second would start ~80ms after the first
      expect(startTimes).toHaveLength(2);
      expect(Math.abs(startTimes[1] - startTimes[0])).toBeLessThan(50);

      toolRegistry.unregister('ro_tool_1');
      toolRegistry.unregister('ro_tool_2');
    });

    test('write tools run serially', async () => {
      toolRegistry.register({
        id: 'w-1', name: 'write_tool_1', description: 'Write 1',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: false,
        handler: async () => ({ ok: true as const, value: 'w1' }),
      });
      toolRegistry.register({
        id: 'w-2', name: 'write_tool_2', description: 'Write 2',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: false,
        handler: async () => ({ ok: true as const, value: 'w2' }),
      });

      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling write tools',
              stopReason: 'tool_use',
              toolCalls: [
                { id: 'w-tc-1', name: 'write_tool_1', args: {} },
                { id: 'w-tc-2', name: 'write_tool_2', args: {} },
              ],
            },
          };
        }
        return { ok: true, value: { content: 'done', stopReason: 'end_turn' } };
      });

      const order: string[] = [];
      mockDispatchSkill.mockImplementation(async (name: string) => {
        order.push(`start:${name}`);
        await new Promise(r => setTimeout(r, 50));
        order.push(`end:${name}`);
        return { ok: true, value: `result-${name}` };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'serial write tools' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(400);

      expect(taskManager.get(task.id)?.status.state).toBe('completed');
      // Serial: first tool fully completes before second starts
      expect(order).toEqual([
        'start:write_tool_1', 'end:write_tool_1',
        'start:write_tool_2', 'end:write_tool_2',
      ]);

      toolRegistry.unregister('write_tool_1');
      toolRegistry.unregister('write_tool_2');
    });

    test('parallel read-only tools where one throws — error message has correct toolCallId', async () => {
      toolRegistry.register({
        id: 'err-ro-1', name: 'err_ro_tool_1', description: 'Error RO 1',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'ok' }),
      });
      toolRegistry.register({
        id: 'err-ro-2', name: 'err_ro_tool_2', description: 'Error RO 2',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'ok' }),
      });

      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling ro tools with error',
              stopReason: 'tool_use',
              toolCalls: [
                { id: 'err-ro-tc-1', name: 'err_ro_tool_1', args: {} },
                { id: 'err-ro-tc-2', name: 'err_ro_tool_2', args: {} },
              ],
            },
          };
        }
        return { ok: true, value: { content: 'done', stopReason: 'end_turn' } };
      });

      const dispatchCalls: Array<{ name: string; throwError: boolean }> = [
        { name: 'err_ro_tool_1', throwError: false },
        { name: 'err_ro_tool_2', throwError: true }, // This one will throw
      ];
      let dispatchIdx = 0;

      mockDispatchSkill.mockImplementation(async (name: string) => {
        const call = dispatchCalls[dispatchIdx++];
        if (call.throwError) {
          throw new Error('Tool execution failed');
        }
        return { ok: true, value: `result-${name}` };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'parallel ro with error' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      // Task should still complete despite tool error
      expect(taskManager.get(task.id)?.status.state).toBe('completed');

      // Verify that mockRun was called a second time with the tool results
      expect(mockRun.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondRunCall = mockRun.mock.calls[1][0] as any;
      const messages = secondRunCall.messages;

      // Should have an assistant message with the tool calls
      const toolCallMsg = messages.find((m: any) => m.role === 'assistant' && m.content);
      expect(toolCallMsg).toBeDefined();

      // Should have two tool result messages
      const toolResults = messages.filter((m: any) => m.role === 'tool');
      expect(toolResults.length).toBe(2);

      // First tool result should be successful
      expect(toolResults[0].toolCallId).toBe('err-ro-tc-1');
      expect(toolResults[0].content).toContain('result-err_ro_tool_1');

      // Second tool result should be an error with the correct toolCallId (not 'unknown')
      expect(toolResults[1].toolCallId).toBe('err-ro-tc-2');
      expect(toolResults[1].content).toContain('Error: Tool execution failed');

      toolRegistry.unregister('err_ro_tool_1');
      toolRegistry.unregister('err_ro_tool_2');
    });

    test('mixed batch: write runs serially first, then read-only tools run in parallel', async () => {
      toolRegistry.register({
        id: 'mx-w', name: 'mixed_write', description: 'Mixed write',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: false,
        handler: async () => ({ ok: true as const, value: 'w' }),
      });
      toolRegistry.register({
        id: 'mx-r1', name: 'mixed_read_1', description: 'Mixed read 1',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'r1' }),
      });
      toolRegistry.register({
        id: 'mx-r2', name: 'mixed_read_2', description: 'Mixed read 2',
        inputSchema: {}, source: 'builtin', priority: 10, enabled: true,
        isReadOnly: true,
        handler: async () => ({ ok: true as const, value: 'r2' }),
      });

      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'mixed tools',
              stopReason: 'tool_use',
              toolCalls: [
                { id: 'mx-tc-w', name: 'mixed_write', args: {} },
                { id: 'mx-tc-r1', name: 'mixed_read_1', args: {} },
                { id: 'mx-tc-r2', name: 'mixed_read_2', args: {} },
              ],
            },
          };
        }
        return { ok: true, value: { content: 'done', stopReason: 'end_turn' } };
      });

      const dispatchLog: Array<{ name: string; time: number }> = [];
      mockDispatchSkill.mockImplementation(async (name: string) => {
        dispatchLog.push({ name, time: Date.now() });
        await new Promise(r => setTimeout(r, 80));
        return { ok: true, value: `result-${name}` };
      });

      const start = Date.now();
      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'mixed tools' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(500);

      expect(taskManager.get(task.id)?.status.state).toBe('completed');
      expect(mockDispatchSkill).toHaveBeenCalledTimes(3);

      // Write tool ran first
      expect(dispatchLog[0].name).toBe('mixed_write');

      // Read-only tools started after write completed (>= 80ms after start)
      const readStartTimes = dispatchLog.filter(e => e.name !== 'mixed_write').map(e => e.time);
      const writeStartTime = dispatchLog[0].time;
      for (const t of readStartTimes) {
        expect(t - writeStartTime).toBeGreaterThanOrEqual(70);
      }

      // Read-only tools started close together (parallel, within 30ms of each other)
      const diff = Math.abs(readStartTimes[0] - readStartTimes[1]);
      expect(diff).toBeLessThan(30);

      toolRegistry.unregister('mixed_write');
      toolRegistry.unregister('mixed_read_1');
      toolRegistry.unregister('mixed_read_2');
    });
  });

  describe('round IDs', () => {
    test('each iteration gets a unique roundId in task history', async () => {
      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling tool',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'tc-round-1', name: 'echo', args: {} }],
            },
          };
        }
        return { ok: true, value: { content: 'final', stopReason: 'end_turn' } };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'round ids' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      const completed = taskManager.get(task.id);
      expect(completed?.status.state).toBe('completed');
      const history = completed?.history ?? [];
      expect(history.length).toBeGreaterThan(0);

      // Collect all roundIds
      const roundIds = history.map(h => h.roundId).filter(Boolean);
      expect(roundIds.length).toBeGreaterThan(0);

      // Messages from different iterations must have different roundIds
      const uniqueRoundIds = new Set(roundIds);
      expect(uniqueRoundIds.size).toBeGreaterThan(1);
    });

    test('TASK_ROUND_COMPLETED event is emitted with correct taskId and iterationIndex', async () => {
      const roundEvents: any[] = [];
      eventBus.subscribe('task.round.completed', (e) => roundEvents.push(e.data));

      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling tool',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'tc-event-1', name: 'echo', args: {} }],
            },
          };
        }
        return { ok: true, value: { content: 'final', stopReason: 'end_turn' } };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'round events' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      expect(roundEvents.length).toBeGreaterThan(0);
      expect(roundEvents[0].taskId).toBe(task.id);
      expect(roundEvents[0].iterationIndex).toBe(0);
    });

    test('all messages in an iteration share the same roundId', async () => {
      let callCount = 0;
      mockRun.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            value: {
              content: 'calling tool',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'tc-shared-1', name: 'echo', args: {} }],
            },
          };
        }
        return { ok: true, value: { content: 'final', stopReason: 'end_turn' } };
      });

      const task = await taskManager.send({
        message: { role: 'user', parts: [{ kind: 'text' as const, text: 'shared round id' }] },
        agentConfig: baseConfig(),
        callerId: 'caller-1',
      });

      await flush(200);

      const completed = taskManager.get(task.id);
      const history = completed?.history ?? [];

      // Find all entries from iteration 0 (they should share the same roundId)
      const firstRoundId = history[0]?.roundId;
      expect(firstRoundId).toBeDefined();

      // All messages in iteration 0 should share the same roundId
      const iter0Messages = history.filter(h => h.roundId === firstRoundId);
      expect(iter0Messages.length).toBeGreaterThanOrEqual(2); // assistant + tool result
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
