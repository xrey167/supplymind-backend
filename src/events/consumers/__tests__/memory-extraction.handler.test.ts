import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { EventBus } from '../../bus';

import { initMemoryExtractionHandler, _resetMemoryExtractionHandler } from '../memory-extraction.handler';

describe('memory extraction handler', () => {
  let bus: EventBus;
  let handlers: Map<string, Function>;
  let mockFindRawById: ReturnType<typeof mock>;
  let mockPropose: ReturnType<typeof mock>;

  beforeEach(() => {
    bus = new EventBus();
    handlers = new Map();
    spyOn(bus, 'subscribe').mockImplementation((topic: string, handler: any) => {
      handlers.set(topic, handler);
      return 'sub-mock';
    });

    mockFindRawById = mock(async () => null);
    mockPropose = mock(async () => ({ id: 'p-1' }));

    _resetMemoryExtractionHandler();
  });

  it('subscribes to TASK_COMPLETED', () => {
    initMemoryExtractionHandler(bus, { findRawById: mockFindRawById } as any, { propose: mockPropose } as any);
    expect(handlers.has('task.completed')).toBe(true);
  });

  it('extracts facts and creates proposals', async () => {
    mockFindRawById.mockResolvedValueOnce({
      id: 'task-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'my name is Alex' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'Hello Alex!' }] },
      ],
    });

    initMemoryExtractionHandler(bus, { findRawById: mockFindRawById } as any, { propose: mockPropose } as any);
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-1' } });

    expect(mockFindRawById).toHaveBeenCalledWith('task-1');
    expect(mockPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        type: 'reference',
        title: 'user_name',
      }),
    );
  });

  it('skips when task not found', async () => {
    initMemoryExtractionHandler(bus, { findRawById: mockFindRawById } as any, { propose: mockPropose } as any);
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-missing' } });

    expect(mockPropose).not.toHaveBeenCalled();
  });

  it('skips when no facts extracted', async () => {
    mockFindRawById.mockResolvedValueOnce({
      id: 'task-2',
      workspaceId: 'ws-1',
      agentId: null,
      sessionId: null,
      history: [],
    });

    initMemoryExtractionHandler(bus, { findRawById: mockFindRawById } as any, { propose: mockPropose } as any);
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-2' } });

    expect(mockPropose).not.toHaveBeenCalled();
  });
});
