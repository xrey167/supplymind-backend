import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock dependencies before importing the handler
const mockFindRawById = mock(() => Promise.resolve(null));
const mockPropose = mock(() => Promise.resolve({ id: 'p-1' }));

mock.module('../../../infra/a2a/task-repo', () => ({
  taskRepo: { findRawById: mockFindRawById },
}));

mock.module('../../../modules/memory/memory.service', () => ({
  memoryService: { propose: mockPropose },
}));

// Capture event subscriptions
const handlers = new Map<string, Function>();
mock.module('../../bus', () => ({
  eventBus: {
    subscribe: (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    },
    publish: mock(() => {}),
  },
}));

mock.module('../../topics', () => ({
  Topics: { TASK_COMPLETED: 'task.completed' },
}));

import { initMemoryExtractionHandler } from '../memory-extraction.handler';

describe('memory extraction handler', () => {
  beforeEach(() => {
    handlers.clear();
    mockFindRawById.mockClear();
    mockPropose.mockClear();
  });

  it('subscribes to TASK_COMPLETED', () => {
    initMemoryExtractionHandler();
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

    initMemoryExtractionHandler();
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-1' } });

    expect(mockFindRawById).toHaveBeenCalledWith('task-1');
    expect(mockPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        type: 'domain',
        title: 'user_name',
        content: 'Alex',
        evidence: 'Auto-extracted from task task-1',
        sessionId: 'sess-1',
      }),
    );
  });

  it('skips when task not found', async () => {
    mockFindRawById.mockResolvedValueOnce(null);

    initMemoryExtractionHandler();
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'missing' } });

    expect(mockPropose).not.toHaveBeenCalled();
  });

  it('skips when no facts extracted', async () => {
    mockFindRawById.mockResolvedValueOnce({
      id: 'task-2',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      sessionId: null,
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'hello' }] },
      ],
    });

    initMemoryExtractionHandler();
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-2' } });

    expect(mockPropose).not.toHaveBeenCalled();
  });
});
