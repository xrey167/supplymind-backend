import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { A2ATask, A2AMessage } from '../../../infra/a2a/types';

// --- Mock state ---
const mockTasks = new Map<string, A2ATask>();
let lastEnqueued: any = null;
let lastCreated: any = null;

const fakeAgent = {
  id: 'agent-1',
  workspaceId: 'ws-1',
  name: 'Test Agent',
  provider: 'anthropic',
  mode: 'chat',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a test agent',
  temperature: 0.7,
  maxTokens: 4096,
  toolIds: [],
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeTask: A2ATask = {
  id: 'task-1',
  status: { state: 'completed', message: 'Done' },
  artifacts: [{ parts: [{ kind: 'text', text: 'result' }] }],
  history: [],
};

// Use DI to inject mock task manager and repo (no mock.module needed).
const mockTaskManager = {
  send: mock(async () => fakeTask),
  get: mock((id: string) => mockTasks.get(id)),
  cancel: mock((id: string) => {
    const t = mockTasks.get(id);
    if (!t) return undefined;
    t.status = { state: 'canceled' };
    return t;
  }),
} as any;

const mockTaskRepo = {
  create: mock(async (data: any) => { lastCreated = data; }),
  findByWorkspace: mock(async () => Array.from(mockTasks.values())),
  findWorkspaceById: mock(async (id: string) => id === 'task-ws1' ? 'ws-1' : undefined),
  removeDependency: mock(async () => {}),
  getDependencies: mock(async () => ({ blockedBy: [], blocks: [] })),
} as any;

const mockAgentsRepo = {
  findById: async (id: string) => id === 'agent-1' ? fakeAgent : null,
} as any;

const mockToAgentConfig = (row: any) => row;

mock.module('../../../infra/queue/bullmq', () => ({
  enqueueAgentRun: async (data: any) => { lastEnqueued = data; return { id: 'job-1' }; },
}));

mock.module('../../../infra/db/client', () => ({
  db: { transaction: async (fn: any) => fn({ select: () => ({ from: () => [] }), insert: () => ({ values: () => {} }) }) },
}));

mock.module('../../../infra/db/schema', () => ({
  taskDependencies: {},
}));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
}));

import { TasksService } from '../tasks.service';
const service = new TasksService(mockAgentsRepo, mockToAgentConfig, mockTaskManager, mockTaskRepo);

describe('TasksService', () => {
  beforeEach(() => {
    mockTasks.clear();
    lastEnqueued = null;
    lastCreated = null;
  });

  test('send foreground returns completed task', async () => {
    const result = await service.send('agent-1', 'hello', 'ws-1', 'user-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('task-1');
      expect(result.value.status.state).toBe('completed');
    }
  });

  test('send returns error for unknown agent', async () => {
    const result = await service.send('agent-unknown', 'hello', 'ws-1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Agent not found');
    }
  });

  test('send background queues job and returns taskId', async () => {
    const result = await service.send(
      'agent-1', 'hello', 'ws-1', 'user-1',
      undefined, undefined, undefined, 'background',
    );
    expect(result.ok).toBe(true);
    if (result.ok && 'queued' in result.value) {
      expect(result.value.queued).toBe(true);
      expect(result.value.jobId).toBe('job-1');
      expect(lastCreated).toBeTruthy();
      expect(lastEnqueued).toBeTruthy();
    }
  });

  test('get returns task from manager', () => {
    mockTasks.set('t-1', { id: 't-1', status: { state: 'working' } });
    const task = service.get('t-1');
    expect(task).toBeDefined();
    expect(task!.status.state).toBe('working');
  });

  test('get returns undefined for missing task', () => {
    expect(service.get('nonexistent')).toBeUndefined();
  });

  test('cancel returns error for wrong workspace', async () => {
    const result = await service.cancel('task-missing', 'ws-1');
    expect(result.ok).toBe(false);
  });

  test('cancel succeeds for correct workspace', async () => {
    mockTasks.set('task-ws1', { id: 'task-ws1', status: { state: 'working' } });
    const result = await service.cancel('task-ws1', 'ws-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status.state).toBe('canceled');
    }
  });
});
