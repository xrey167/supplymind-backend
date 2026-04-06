import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import type { CoordinatorRunInput } from '../coordinator';
import { taskManager } from '../../infra/a2a/task-manager';
import { eventBus } from '../../events/bus';
import { CoordinatorMode } from '../coordinator';

const mockSend = spyOn(taskManager, 'send').mockResolvedValue({
  id: 'task-1',
  status: { state: 'completed' as const },
  artifacts: [{ name: 'out', parts: [{ kind: 'text', text: 'result' }] }],
  history: [],
} as any);

const publishSpy = spyOn(eventBus, 'publish').mockResolvedValue({
  id: 'e', topic: '', data: {}, source: '', timestamp: '',
} as any);

afterAll(() => {
  mockSend.mockRestore();
  publishSpy.mockRestore();
});

const BASE_INPUT: CoordinatorRunInput = {
  workspaceId: 'ws-1',
  phases: [
    {
      id: 'phase-1',
      label: 'Research',
      tasks: [
        { name: 'task-a', agentId: 'agent-1', message: { role: 'user', parts: [{ kind: 'text', text: 'Do research' }] } },
        { name: 'task-b', agentId: 'agent-2', message: { role: 'user', parts: [{ kind: 'text', text: 'Gather data' }] } },
      ],
    },
  ],
};

describe('CoordinatorMode', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({
      id: 'task-1',
      status: { state: 'completed' as const },
      artifacts: [{ name: 'out', parts: [{ kind: 'text', text: 'result' }] }],
      history: [],
    } as any);
  });

  it('runs all phases and returns completed', async () => {
    const coordinator = new CoordinatorMode();
    const result = await coordinator.run(BASE_INPUT);
    expect(result.status).toBe('completed');
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].phaseId).toBe('phase-1');
  });

  it('dispatches all tasks in a phase in parallel', async () => {
    const coordinator = new CoordinatorMode();
    await coordinator.run(BASE_INPUT);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('handles multi-phase run sequentially', async () => {
    const order: string[] = [];
    mockSend.mockImplementation(async (params) => {
      order.push(params.agentConfig.id);
      return { id: 'task-1', status: { state: 'completed' as const }, artifacts: [], history: [] } as any;
    });
    const input: CoordinatorRunInput = {
      workspaceId: 'ws-1',
      phases: [
        { id: 'p1', label: 'Phase 1', tasks: [{ name: 't1', agentId: 'a1', message: { role: 'user', parts: [] } }] },
        { id: 'p2', label: 'Phase 2', tasks: [{ name: 't2', agentId: 'a2', message: { role: 'user', parts: [] } }] },
      ],
    };
    const coordinator = new CoordinatorMode();
    const result = await coordinator.run(input);
    expect(result.phases).toHaveLength(2);
    expect(order[0]).toBe('a1');
    expect(order[1]).toBe('a2');
  });

  it('produces partial handoff on timeout when allowPartialHandoff=true', async () => {
    let timerFired = false;
    const fastTimeout: typeof setTimeout = ((fn: () => void) => {
      fn();
      timerFired = true;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const input: CoordinatorRunInput = {
      workspaceId: 'ws-1',
      allowPartialHandoff: true,
      _setTimeout: fastTimeout,
      phases: [
        { id: 'p1', label: 'Timeout Phase', timeoutMs: 1, tasks: [{ name: 't1', agentId: 'a1', message: { role: 'user', parts: [] } }] },
      ],
    };
    const coordinator = new CoordinatorMode();
    const result = await coordinator.run(input);
    expect(result.status).toBe('completed');
    expect(result.phases[0].status).toBe('failed');
  });

  it('stops on phase failure when allowPartialHandoff=false', async () => {
    mockSend.mockImplementation(async () => ({
      id: 'task-1',
      status: { state: 'failed' as const },
      artifacts: [],
      history: [],
    } as any));
    const input: CoordinatorRunInput = {
      workspaceId: 'ws-1',
      allowPartialHandoff: false,
      phases: [
        { id: 'p1', label: 'Phase 1', tasks: [{ name: 't1', agentId: 'a1', message: { role: 'user', parts: [] } }] },
        { id: 'p2', label: 'Phase 2', tasks: [{ name: 't2', agentId: 'a2', message: { role: 'user', parts: [] } }] },
      ],
    };
    const coordinator = new CoordinatorMode();
    const result = await coordinator.run(input);
    expect(result.status).toBe('failed');
    expect(result.phases).toHaveLength(1);
  });
});
