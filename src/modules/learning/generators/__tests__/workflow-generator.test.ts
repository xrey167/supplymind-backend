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
// Stub side-effect modules (spread to preserve other exports)
// ---------------------------------------------------------------------------
const _realWorkflowsSvc = require('../../../workflows/workflows.service');
mock.module('../../../workflows/workflows.service', () => ({
  ..._realWorkflowsSvc,
  workflowsService: { create: mock(() => Promise.resolve({ ok: true, value: { id: 'wf-1' } })) },
}));

const _realLogger = require('../../../../config/logger');
mock.module('../../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Dynamic import so mocks intercept
// ---------------------------------------------------------------------------
const { detectRepeatedSequences, proposeWorkflowTemplate } = await import('../workflow-generator?fresh=1' as string);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeSequence = (overrides: Record<string, unknown> = {}) => ({
  steps: ['fetch_inventory', 'calculate_shipping', 'create_order'],
  occurrences: 8,
  workspaceId: 'ws-1',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('workflow-generator', () => {
  beforeEach(() => {
    dbRows = [];
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
  // detectRepeatedSequences
  // -----------------------------------------------------------------------
  describe('detectRepeatedSequences', () => {
    it('finds patterns with 5+ occurrences', async () => {
      dbRows = [
        { sequence: JSON.stringify(['fetch_inventory', 'calculate_shipping']), count: 7 },
        { sequence: JSON.stringify(['validate', 'submit', 'notify']), count: 5 },
      ];

      const sequences = await detectRepeatedSequences('ws-1', { select: mockSelect } as any);

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.steps).toEqual(['fetch_inventory', 'calculate_shipping']);
      expect(sequences[0]!.occurrences).toBe(7);
      expect(sequences[0]!.workspaceId).toBe('ws-1');
      expect(sequences[1]!.steps).toEqual(['validate', 'submit', 'notify']);
      expect(sequences[1]!.occurrences).toBe(5);
    });

    it('filters out patterns with < 5 occurrences', async () => {
      dbRows = [
        { sequence: JSON.stringify(['fetch_inventory', 'calculate_shipping']), count: 7 },
        { sequence: JSON.stringify(['rare_step_a', 'rare_step_b']), count: 4 },
        { sequence: JSON.stringify(['once_a', 'once_b']), count: 1 },
      ];

      const sequences = await detectRepeatedSequences('ws-1', { select: mockSelect } as any);

      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.steps).toEqual(['fetch_inventory', 'calculate_shipping']);
    });

    it('filters out single-step sequences', async () => {
      dbRows = [
        { sequence: JSON.stringify(['only_one_step']), count: 10 },
        { sequence: JSON.stringify(['step_a', 'step_b']), count: 6 },
      ];

      const sequences = await detectRepeatedSequences('ws-1', { select: mockSelect } as any);

      // Single-step filtered out (needs >= 2 steps)
      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.steps).toEqual(['step_a', 'step_b']);
    });

    it('handles malformed JSON gracefully', async () => {
      dbRows = [
        { sequence: 'not valid json{{{', count: 10 },
        { sequence: JSON.stringify(['good_a', 'good_b']), count: 5 },
      ];

      const sequences = await detectRepeatedSequences('ws-1', { select: mockSelect } as any);

      // Malformed JSON → steps = [] → filtered out (length < 2)
      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.steps).toEqual(['good_a', 'good_b']);
    });
  });

  // -----------------------------------------------------------------------
  // proposeWorkflowTemplate (pure function)
  // -----------------------------------------------------------------------
  describe('proposeWorkflowTemplate', () => {
    it('produces correct proposal shape', () => {
      const seq = makeSequence();
      const proposal = proposeWorkflowTemplate(seq);

      expect(proposal.proposalType).toBe('workflow_template');
      expect(proposal.changeType).toBe('structural');
      expect(proposal.workspaceId).toBe('ws-1');
      expect(proposal.beforeValue).toBeNull();

      const after = proposal.afterValue as Record<string, unknown>;
      expect(after.templateName).toContain('auto:');
      expect(after.stepCount).toBe(3);
      expect(after.definition).toBeDefined();

      const def = after.definition as { steps: Array<{ id: string; skillId: string; dependsOn: string[] }> };
      expect(def.steps).toHaveLength(3);
    });

    it('sets dependsOn correctly (step-N depends on step-(N-1))', () => {
      const seq = makeSequence({ steps: ['a', 'b', 'c'] });
      const proposal = proposeWorkflowTemplate(seq);

      const after = proposal.afterValue as Record<string, unknown>;
      const def = after.definition as { steps: Array<{ id: string; skillId: string; dependsOn: string[] }> };

      // step-1 has no dependencies
      expect(def.steps[0]!.id).toBe('step-1');
      expect(def.steps[0]!.skillId).toBe('a');
      expect(def.steps[0]!.dependsOn).toEqual([]);

      // step-2 depends on step-1
      expect(def.steps[1]!.id).toBe('step-2');
      expect(def.steps[1]!.skillId).toBe('b');
      expect(def.steps[1]!.dependsOn).toEqual(['step-1']);

      // step-3 depends on step-2
      expect(def.steps[2]!.id).toBe('step-3');
      expect(def.steps[2]!.skillId).toBe('c');
      expect(def.steps[2]!.dependsOn).toEqual(['step-2']);
    });

    it('confidence formula: min(0.9, 0.5 + occ * 0.05)', () => {
      // 8 occurrences: min(0.9, 0.5 + 8*0.05) = min(0.9, 0.9) = 0.9
      const p1 = proposeWorkflowTemplate(makeSequence({ occurrences: 8 }));
      expect(p1.confidence).toBe(0.9);

      // 5 occurrences: min(0.9, 0.5 + 5*0.05) = min(0.9, 0.75) = 0.75
      const p2 = proposeWorkflowTemplate(makeSequence({ occurrences: 5 }));
      expect(p2.confidence).toBe(0.75);

      // 20 occurrences: min(0.9, 0.5 + 20*0.05) = min(0.9, 1.5) = 0.9 (capped)
      const p3 = proposeWorkflowTemplate(makeSequence({ occurrences: 20 }));
      expect(p3.confidence).toBe(0.9);
    });
  });
});

afterAll(() => mock.restore());
