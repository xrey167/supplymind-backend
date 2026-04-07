import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { EventBus } from '../../bus';
import { taskRepo } from '../../../infra/a2a/task-repo';
import { memoryService } from '../../../modules/memory/memory.service';

// Mock taskRepo and memoryService via spyOn to avoid polluting other test files
const mockFindRawById = spyOn(taskRepo, 'findRawById').mockResolvedValue(null as any);
const mockPropose = spyOn(memoryService, 'propose').mockResolvedValue({ id: 'p-1' } as any);

afterAll(() => {
  mockFindRawById.mockRestore();
  mockPropose.mockRestore();
});

import { initMemoryExtractionHandler, _resetMemoryExtractionHandler } from '../memory-extraction.handler';

describe('memory extraction handler', () => {
  let bus: EventBus;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    bus = new EventBus();
    handlers = new Map();
    spyOn(bus, 'subscribe').mockImplementation((topic: string, handler: any) => {
      handlers.set(topic, handler);
      return 'sub-mock';
    });
    mockFindRawById.mockClear();
    mockPropose.mockClear();
    _resetMemoryExtractionHandler();
  });

  it('subscribes to TASK_COMPLETED', () => {
    initMemoryExtractionHandler(bus);
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

    initMemoryExtractionHandler(bus);
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
    mockFindRawById.mockResolvedValueOnce(null);

    initMemoryExtractionHandler(bus);
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

    initMemoryExtractionHandler(bus);
    const handler = handlers.get('task.completed')!;
    await handler({ data: { taskId: 'task-2' } });

    expect(mockPropose).not.toHaveBeenCalled();
  });
});
