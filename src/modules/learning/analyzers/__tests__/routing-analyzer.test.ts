import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

/* ------------------------------------------------------------------ */
/*  Mock: Two parallel db.select({count}).from().where() calls        */
/*  First call = task_completed count, Second call = task_error count */
/* ------------------------------------------------------------------ */

let completedCount = 0;
let errorCount = 0;
let callIndex = 0;

const makeChain = (resolveValue: () => any) => {
  const where = mock(() => Promise.resolve([{ count: resolveValue() }]));
  const from = mock(() => ({ where }));
  return { from, where };
};

// We need two separate chains because Promise.all fires two selects.
// Track call order to return the right chain.
const chain1 = makeChain(() => completedCount);
const chain2 = makeChain(() => errorCount);

const mockSelect = mock(() => {
  callIndex++;
  if (callIndex % 2 === 1) return { from: chain1.from };
  return { from: chain2.from };
});

const mockDb = { select: mockSelect } as any;

const { analyzeRouting } = await import('../routing-analyzer?fresh=1' as string);

describe('analyzeRouting', () => {
  beforeEach(() => {
    completedCount = 0;
    errorCount = 0;
    callIndex = 0;
    mockSelect.mockClear();
    chain1.from.mockClear();
    chain1.where.mockClear();
    chain2.from.mockClear();
    chain2.where.mockClear();

    // Re-apply implementations — mockClear only resets call history, not behavior
    chain1.where.mockImplementation(() => Promise.resolve([{ count: completedCount }]));
    chain1.from.mockImplementation(() => ({ where: chain1.where }));
    chain2.where.mockImplementation(() => Promise.resolve([{ count: errorCount }]));
    chain2.from.mockImplementation(() => ({ where: chain2.where }));
    mockSelect.mockImplementation(() => {
      callIndex++;
      if (callIndex % 2 === 1) return { from: chain1.from };
      return { from: chain2.from };
    });
  });

  it('produces a routing_rule proposal when error rate > 25%', async () => {
    completedCount = 7;
    errorCount = 5; // 5/(7+5) = 41.7% error rate, total=12 >= 10

    const proposals = await analyzeRouting('ws-1', mockDb);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.workspaceId).toBe('ws-1');
    expect(p.proposalType).toBe('routing_rule');
    expect(p.changeType).toBe('behavioral');
    expect(p.description).toContain('42%'); // Math.round(0.4166... * 100) = 42
    expect(p.evidence).toContain('total_tasks=12');
    expect(p.evidence).toContain('error_count=5');
    expect(p.beforeValue).toEqual({ tier: 'balanced' });
    expect(p.afterValue).toEqual({ tier: 'powerful', reason: 'high_task_error_rate' });
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(0.85);
  });

  it('returns empty array when error rate is below 25%', async () => {
    completedCount = 9;
    errorCount = 1; // 1/10 = 10% error rate

    const proposals = await analyzeRouting('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });

  it('returns empty array when total observations < 10', async () => {
    completedCount = 3;
    errorCount = 3; // total=6 < 10

    const proposals = await analyzeRouting('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });
});

afterAll(() => mock.restore());
