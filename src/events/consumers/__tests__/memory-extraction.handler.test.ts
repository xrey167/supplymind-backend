import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { eventBus } from '../../bus';
import { taskRepo } from '../../../infra/a2a/task-repo';
import { memoryService } from '../../../modules/memory/memory.service';

// Mock taskRepo and memoryService via spyOn to avoid polluting other test files
const mockFindRawById = spyOn(taskRepo, 'findRawById').mockResolvedValue(null as any);
const mockPropose = spyOn(memoryService, 'propose').mockResolvedValue({ id: 'p-1' } as any);

// Capture event subscriptions via spyOn so the real bus still works in other tests
const handlers = new Map<string, Function>();
const subscribeSpy = spyOn(eventBus, 'subscribe').mockImplementation((topic: string, handler: any) => {
  handlers.set(topic, handler);
  return () => {};
});

afterAll(() => {
  mockFindRawById.mockRestore();
  mockPropose.mockRestore();
  subscribeSpy.mockRestore();
});

import { initMemoryExtractionHandler, _resetMemoryExtractionHandler } from '../memory-extraction.handler';

describe('memory extraction handler', () => {
  beforeEach(() => {
    handlers.clear();
    mockFindRawById.mockClear();
    mockPropose.mockClear();
    _resetMemoryExtractionHandler();
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
        type: 'reference',
        title: 'user_name',
        content: 'Alex',
        evidence: 'Auto-extracted (scope: user) from task task-1',
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
