import { describe, it, expect, beforeEach, mock, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// DB mock — chainable select().from().where().groupBy()
// ---------------------------------------------------------------------------
let dbRows: any[] = [];

const mockGroupBy = mock(() => Promise.resolve(dbRows));
const mockWhere = mock(() => ({ groupBy: mockGroupBy }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

// ---------------------------------------------------------------------------
// AnthropicRawRuntime mock (spread to preserve other runtime exports)
// ---------------------------------------------------------------------------
let mockRunResult: any = { ok: true, value: { content: '' } };

const mockRun = mock(async () => mockRunResult);

const _realAnthropic = require('../../../../infra/ai/anthropic');
mock.module('../../../../infra/ai/anthropic', () => ({
  ..._realAnthropic,
  AnthropicRawRuntime: class {
    run = mockRun;
  },
}));

// ---------------------------------------------------------------------------
// Stub out side-effect modules (spread to preserve all exports)
// ---------------------------------------------------------------------------
const _realSandbox = require('../../../../core/security/sandbox');
mock.module('../../../../core/security/sandbox', () => ({
  ..._realSandbox,
  runInSandbox: mock(() => Promise.resolve({ ok: true, value: { value: {} } })),
}));

const _realRegistry = require('../../../skills/skills.registry');
mock.module('../../../skills/skills.registry', () => ({
  ..._realRegistry,
  skillRegistry: { register: mock(() => {}), get: mock(() => null), unregister: mock(() => undefined) },
}));

// core/result: MUST spread — bare replacement strips err(), isOk(), etc. for all downstream tests
const _realResult = require('../../../../core/result');
mock.module('../../../../core/result', () => ({
  ..._realResult,
  ok: (v: unknown) => ({ ok: true, value: v }),
}));

const _realLogger = require('../../../../config/logger');
mock.module('../../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Dynamic import so mocks intercept
// ---------------------------------------------------------------------------
const { detectSkillGaps, generateSkillForGap } = await import('../skill-generator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_LLM_CONTENT = `// name: calculate_shipping_cost
// description: Calculate shipping cost based on weight and destination
// inputSchema: {"type": "object", "properties": {"weight": {"type": "number"}, "destination": {"type": "string"}}}
\`\`\`typescript
// name: calculate_shipping_cost
// description: Calculate shipping cost based on weight and destination
// inputSchema: {"type": "object", "properties": {"weight": {"type": "number"}, "destination": {"type": "string"}}}
async function handler(args: Record<string, unknown>): Promise<unknown> {
  if (!args.weight) throw new Error('Missing weight');
  if (!args.destination) throw new Error('Missing destination');
  const weight = Number(args.weight);
  const cost = weight * 2.5;
  return { cost, currency: 'USD' };
}
\`\`\``;

const makeGap = (overrides: Record<string, unknown> = {}) => ({
  skillName: 'calculate_shipping_cost',
  occurrences: 5,
  workspaceId: 'ws-1',
  context: 'shipping module',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('skill-generator', () => {
  beforeEach(() => {
    dbRows = [];
    mockRun.mockClear();
    mockGroupBy.mockClear();
    mockWhere.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();

    mockGroupBy.mockImplementation(() => Promise.resolve(dbRows));
    mockWhere.mockImplementation(() => ({ groupBy: mockGroupBy }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  // -----------------------------------------------------------------------
  // detectSkillGaps
  // -----------------------------------------------------------------------
  describe('detectSkillGaps', () => {
    it('returns gaps when count >= 3', async () => {
      dbRows = [
        { skillName: 'calculate_shipping_cost', context: 'shipping', count: 5 },
        { skillName: 'track_order', context: 'orders', count: 3 },
      ];

      const gaps = await detectSkillGaps('ws-1', { select: mockSelect } as any);

      expect(gaps).toHaveLength(2);
      expect(gaps[0]!.skillName).toBe('calculate_shipping_cost');
      expect(gaps[0]!.occurrences).toBe(5);
      expect(gaps[0]!.workspaceId).toBe('ws-1');
      expect(gaps[1]!.skillName).toBe('track_order');
      expect(gaps[1]!.occurrences).toBe(3);
    });

    it('filters out gaps with count < 3', async () => {
      dbRows = [
        { skillName: 'calculate_shipping_cost', context: 'shipping', count: 5 },
        { skillName: 'rare_skill', context: 'misc', count: 2 },
        { skillName: 'once_skill', context: 'misc', count: 1 },
      ];

      const gaps = await detectSkillGaps('ws-1', { select: mockSelect } as any);

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.skillName).toBe('calculate_shipping_cost');
    });

    it('filters out rows with null skillName', async () => {
      dbRows = [
        { skillName: null, context: 'shipping', count: 10 },
        { skillName: '', context: 'shipping', count: 5 },
        { skillName: 'valid_skill', context: 'shipping', count: 4 },
      ];

      const gaps = await detectSkillGaps('ws-1', { select: mockSelect } as any);

      // null and empty string are both falsy, only 'valid_skill' passes
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.skillName).toBe('valid_skill');
    });
  });

  // -----------------------------------------------------------------------
  // generateSkillForGap
  // -----------------------------------------------------------------------
  describe('generateSkillForGap', () => {
    it('produces proposal with correct shape when LLM succeeds', async () => {
      mockRunResult = { ok: true, value: { content: VALID_LLM_CONTENT } };

      const gap = makeGap();
      const proposal = await generateSkillForGap(gap, 'Logistics domain');

      expect(proposal).not.toBeNull();
      expect(proposal!.proposalType).toBe('new_skill');
      expect(proposal!.changeType).toBe('structural');
      expect(proposal!.workspaceId).toBe('ws-1');
      expect(proposal!.afterValue).toBeDefined();

      const after = proposal!.afterValue as Record<string, unknown>;
      expect(after.skillName).toBe('calculate_shipping_cost');
      expect(after.description).toBe('Calculate shipping cost based on weight and destination');
      // Note: the parser regex `{[^}]+}` can't capture nested braces,
      // so the nested properties JSON falls back to the default schema.
      expect(after.inputSchema).toEqual({ type: 'object', properties: {} });
      expect(typeof after.handlerCode).toBe('string');

      // Confidence: min(0.8, 0.5 + 5 * 0.05) = min(0.8, 0.75) = 0.75
      expect(proposal!.confidence).toBe(0.75);
    });

    it('returns null when LLM call fails (result.ok = false)', async () => {
      mockRunResult = { ok: false, error: { message: 'rate limit exceeded' } };

      const proposal = await generateSkillForGap(makeGap(), 'context');

      expect(proposal).toBeNull();
    });

    it('returns null when LLM output cannot be parsed', async () => {
      mockRunResult = {
        ok: true,
        value: { content: 'Here is some text that has no code block or metadata markers.' },
      };

      const proposal = await generateSkillForGap(makeGap(), 'context');

      expect(proposal).toBeNull();
    });
  });
});

afterAll(() => mock.restore());
