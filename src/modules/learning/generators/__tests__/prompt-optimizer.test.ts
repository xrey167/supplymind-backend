import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// DB mock — two parallel db.select() chains for completed + error counts
// ---------------------------------------------------------------------------
let selectCallCount = 0;
let completedRows: any[] = [];
let errorRows: any[] = [];

const mockGroupBy = mock(() => {
  selectCallCount++;
  if (selectCallCount === 1) return Promise.resolve(completedRows);
  return Promise.resolve(errorRows);
});
const mockWhere = mock(() => ({ groupBy: mockGroupBy }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

// ---------------------------------------------------------------------------
// Schema mock
// ---------------------------------------------------------------------------
mock.module('../../../../infra/db/client', () => ({ db: {} }));
mock.module('../../../../infra/db/schema', () => ({
  learningObservations: Symbol('learningObservations'),
}));

// ---------------------------------------------------------------------------
// drizzle-orm mock
// ---------------------------------------------------------------------------
mock.module('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
  gte: (a: unknown, b: unknown) => [a, b],
  sql: Object.assign((strings: TemplateStringsArray, ..._vals: unknown[]) => strings.join(''), {
    raw: (s: string) => s,
  }),
}));

// ---------------------------------------------------------------------------
// AnthropicRawRuntime mock
// ---------------------------------------------------------------------------
let mockRunResult: any = { ok: true, value: { content: 'Improved system prompt here.' } };

const mockRun = mock(async () => mockRunResult);

mock.module('../../../../infra/ai/anthropic', () => ({
  AnthropicRawRuntime: class {
    run = mockRun;
  },
}));

// ---------------------------------------------------------------------------
// Stub side-effect modules
// ---------------------------------------------------------------------------
mock.module('../../../prompts/prompts.service', () => ({
  promptsService: { create: mock(() => Promise.resolve({ ok: true, value: { id: 'p1' } })) },
}));

mock.module('../../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Dynamic import so mocks intercept
// ---------------------------------------------------------------------------
const { findUnderperformingAgents, generatePromptVariant } = await import('../prompt-optimizer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makePerformance = (overrides: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  completionRate: 0.6,
  taskCount: 20,
  errorCount: 8,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('prompt-optimizer', () => {
  beforeEach(() => {
    selectCallCount = 0;
    completedRows = [];
    errorRows = [];
    mockRun.mockClear();
    mockGroupBy.mockClear();
    mockWhere.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();

    mockGroupBy.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(completedRows);
      return Promise.resolve(errorRows);
    });
    mockWhere.mockImplementation(() => ({ groupBy: mockGroupBy }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  // -----------------------------------------------------------------------
  // findUnderperformingAgents
  // -----------------------------------------------------------------------
  describe('findUnderperformingAgents', () => {
    it('returns agents below 80% completion rate with >= 10 tasks', async () => {
      completedRows = [
        { agentId: 'agent-1', count: 12 },
        { agentId: 'agent-2', count: 6 },
      ];
      errorRows = [
        { agentId: 'agent-1', count: 8 },
        { agentId: 'agent-2', count: 4 },
      ];

      const results = await findUnderperformingAgents('ws-1', { select: mockSelect } as any);

      // agent-1: 20 total, 12 completed, 8 errors → rate = 12/20 = 0.6 → below 0.8
      // agent-2: 10 total, 6 completed, 4 errors → rate = 6/10 = 0.6 → below 0.8
      expect(results).toHaveLength(2);
      expect(results[0]!.agentId).toBe('agent-1');
      expect(results[0]!.completionRate).toBe(0.6);
      expect(results[0]!.taskCount).toBe(20);
      expect(results[0]!.errorCount).toBe(8);
    });

    it('filters out agents with < 10 total tasks', async () => {
      completedRows = [
        { agentId: 'agent-1', count: 12 },
        { agentId: 'agent-small', count: 3 },
      ];
      errorRows = [
        { agentId: 'agent-1', count: 8 },
        { agentId: 'agent-small', count: 3 },
      ];

      const results = await findUnderperformingAgents('ws-1', { select: mockSelect } as any);

      // agent-small: 6 total → filtered out (< 10)
      expect(results).toHaveLength(1);
      expect(results[0]!.agentId).toBe('agent-1');
    });

    it('filters out agents at or above 80% completion rate', async () => {
      completedRows = [
        { agentId: 'good-agent', count: 18 },
        { agentId: 'bad-agent', count: 5 },
      ];
      errorRows = [
        { agentId: 'good-agent', count: 2 },
        { agentId: 'bad-agent', count: 10 },
      ];

      const results = await findUnderperformingAgents('ws-1', { select: mockSelect } as any);

      // good-agent: 20 total, rate = 18/20 = 0.9 → above threshold, filtered
      // bad-agent:  15 total, rate = 5/15 = 0.333 → below threshold
      expect(results).toHaveLength(1);
      expect(results[0]!.agentId).toBe('bad-agent');
    });
  });

  // -----------------------------------------------------------------------
  // generatePromptVariant
  // -----------------------------------------------------------------------
  describe('generatePromptVariant', () => {
    it('produces prompt_update proposal on success', async () => {
      mockRunResult = { ok: true, value: { content: 'Improved system prompt here.' } };

      const perf = makePerformance();
      const proposal = await generatePromptVariant('ws-1', perf, 'You are a helpful agent.', 'Logistics');

      expect(proposal).not.toBeNull();
      expect(proposal!.proposalType).toBe('prompt_update');
      expect(proposal!.changeType).toBe('structural');
      expect(proposal!.workspaceId).toBe('ws-1');

      const after = proposal!.afterValue as Record<string, unknown>;
      expect(after.agentId).toBe('agent-1');
      expect(typeof after.systemPrompt).toBe('string');
      expect(typeof after.fullPrompt).toBe('string');

      // Confidence: min(0.85, 1 - 0.6 + 0.2) = min(0.85, 0.6) = 0.6
      expect(proposal!.confidence).toBeCloseTo(0.6, 10);
    });

    it('returns null when currentSystemPrompt is empty', async () => {
      const proposal = await generatePromptVariant('ws-1', makePerformance(), '', 'context');

      expect(proposal).toBeNull();
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('returns null when LLM fails', async () => {
      mockRunResult = { ok: false, error: { message: 'API error' } };

      const proposal = await generatePromptVariant('ws-1', makePerformance(), 'You are a helpful agent.', 'context');

      expect(proposal).toBeNull();
    });
  });
});
