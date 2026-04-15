import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ---- Worker capture setup ----
// We capture the processor and event handlers registered with the Worker constructor
// so we can invoke them directly in tests without needing a real Redis connection.

type WorkerProcessor = (job: { data: Record<string, unknown> }) => Promise<void>;
type FailedHandler = (job: { id: string; data: Record<string, unknown> } | undefined, err: Error) => void;

let capturedProcessor: WorkerProcessor | undefined;
const capturedHandlers = new Map<string, FailedHandler>();

class MockWorker {
  constructor(_queueName: string, processor: WorkerProcessor, _opts: unknown) {
    capturedProcessor = processor;
  }

  on(event: string, handler: FailedHandler) {
    capturedHandlers.set(event, handler);
  }
}

mock.module('bullmq', () => ({
  Worker: MockWorker,
  Queue: class MockQueue { constructor() {} add() { return Promise.resolve({}); } close() { return Promise.resolve(); } },
  QueueEvents: class MockQueueEvents { constructor() {} on() {} close() { return Promise.resolve(); } },
}));

// ---- Redis mock ----
mock.module('ioredis', () => ({
  default: class MockRedis {
    constructor() {}
  },
}));

// ---- taskRepo mock (DI — no mock.module needed) ----
const mockUpdateStatus = mock(async () => {});
const mockTaskRepo = { updateStatus: mockUpdateStatus } as any;

// ---- mockAgentsService (passed directly to startAgentWorkers to avoid module mock contamination) ----
const fakeAgentRow = {
  id: 'agent-1',
  workspaceId: 'ws-1',
  name: 'Test Agent',
  provider: 'openai',
  mode: 'chat',
  model: 'gpt-4o',
  systemPrompt: 'You are helpful',
  temperature: 0.7,
  maxTokens: 2000,
  toolIds: [],
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockGetById = mock(async (id: string) => {
  if (id === 'agent-1') return { ok: true as const, value: fakeAgentRow };
  return { ok: false as const, error: new Error(`Agent not found: ${id}`) };
});

const mockAgentsService = { getById: mockGetById };

// ---- taskManager mock (DI — no mock.module needed) ----
const mockSend = mock(async (_opts: any) => {});
const mockTaskManager = { send: mockSend } as any;

// ---- logger mock ----
const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) },
}));

// Import AFTER mocks and call startAgentWorkers to capture processor + handlers
import { startAgentWorkers } from '../index';
startAgentWorkers(1, mockAgentsService as any, mockTaskManager, mockTaskRepo);

// ---- Fixtures ----
const makeJobData = (overrides: Record<string, unknown> = {}) => ({
  taskId: 'task-1',
  agentId: 'agent-1',
  workspaceId: 'ws-1',
  callerId: 'user-1',
  message: { role: 'user', content: 'Hello' },
  sessionId: 'session-1',
  ...overrides,
});

function resetMocks() {
  mockGetById.mockClear();
  mockSend.mockClear();
  mockUpdateStatus.mockClear();
}

// ---- Tests ----
describe('agent worker', () => {
  beforeEach(resetMocks);

  describe('processor', () => {
    it('calls agentsService.getById with agentId from job data', async () => {
      const data = makeJobData();
      await capturedProcessor!({ data });

      expect(mockGetById).toHaveBeenCalledTimes(1);
      expect(mockGetById).toHaveBeenCalledWith('agent-1');
    });

    it('calls taskManager.send with correct params', async () => {
      const data = makeJobData();
      await capturedProcessor!({ data });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.id).toBe('task-1');
      expect(callArg.sessionId).toBe('session-1');
      expect(callArg.callerId).toBe('user-1');
      const agentConfig = callArg.agentConfig as Record<string, unknown>;
      expect(agentConfig.id).toBe('agent-1');
      expect(agentConfig.workspaceId).toBe('ws-1');
    });

    it('throws when agent is not found', async () => {
      mockGetById.mockImplementationOnce(async (id: string) => ({ ok: false as const, error: new Error(`Agent not found: ${id}`) }));

      const data = makeJobData({ agentId: 'missing-agent' });
      await expect(capturedProcessor!({ data })).rejects.toThrow('Agent not found: missing-agent');
    });
  });

  describe('failed handler', () => {
    it('calls taskRepo.updateStatus with failed status when taskId is present', async () => {
      const handler = capturedHandlers.get('failed')!;
      const job = { id: 'job-1', data: makeJobData() };
      const error = new Error('Something broke');

      handler(job, error);

      // updateStatus is called asynchronously (fire-and-forget)
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
      expect(mockUpdateStatus).toHaveBeenCalledWith('task-1', 'failed', 'Error: Something broke');
    });

    it('does not throw when job is undefined (missing job)', () => {
      const handler = capturedHandlers.get('failed')!;
      const error = new Error('Queue crash');

      expect(() => handler(undefined, error)).not.toThrow();
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('does not call updateStatus when taskId is missing from job data', async () => {
      const handler = capturedHandlers.get('failed')!;
      const job = { id: 'job-2', data: makeJobData({ taskId: undefined }) };
      const error = new Error('No task id');

      handler(job, error);

      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });
  });
});

afterAll(() => mock.restore());
