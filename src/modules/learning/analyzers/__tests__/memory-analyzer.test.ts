import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

/* ------------------------------------------------------------------ */
/*  Mock: Two parallel db.select({count}).from().where() calls        */
/*  First call = memory_approved count, Second = memory_rejected      */
/* ------------------------------------------------------------------ */

let approvedCount = 0;
let rejectedCount = 0;
let callIndex = 0;

const makeChain = (resolveValue: () => any) => {
  const where = mock(() => Promise.resolve([{ count: resolveValue() }]));
  const from = mock(() => ({ where }));
  return { from, where };
};

const chain1 = makeChain(() => approvedCount);
const chain2 = makeChain(() => rejectedCount);

const mockSelect = mock(() => {
  callIndex++;
  if (callIndex % 2 === 1) return { from: chain1.from };
  return { from: chain2.from };
});

const mockDb = { select: mockSelect } as any;

const { analyzeMemoryQuality } = await import('../memory-analyzer?fresh=1' as string);

describe('analyzeMemoryQuality', () => {
  beforeEach(() => {
    approvedCount = 0;
    rejectedCount = 0;
    callIndex = 0;
    mockSelect.mockClear();
    chain1.from.mockClear();
    chain1.where.mockClear();
    chain2.from.mockClear();
    chain2.where.mockClear();

    // Re-apply implementations — mockClear only resets call history, not behavior
    chain1.where.mockImplementation(() => Promise.resolve([{ count: approvedCount }]));
    chain1.from.mockImplementation(() => ({ where: chain1.where }));
    chain2.where.mockImplementation(() => Promise.resolve([{ count: rejectedCount }]));
    chain2.from.mockImplementation(() => ({ where: chain2.where }));
    mockSelect.mockImplementation(() => {
      callIndex++;
      if (callIndex % 2 === 1) return { from: chain1.from };
      return { from: chain2.from };
    });
  });

  it('produces a memory_threshold proposal when rejection rate > 50%', async () => {
    approvedCount = 2;
    rejectedCount = 8; // 8/(2+8) = 80% rejection rate, total=10 >= 5

    const proposals = await analyzeMemoryQuality('ws-1', mockDb);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.workspaceId).toBe('ws-1');
    expect(p.proposalType).toBe('memory_threshold');
    expect(p.changeType).toBe('behavioral');
    expect(p.description).toContain('80%'); // Math.round(0.8 * 100)
    expect(p.description).toContain('8/10');
    expect(p.description).toContain('0.7');  // currentThreshold
    // newThreshold = 0.7 + 0.1; floating-point produces 0.7999999999999999
    expect(p.description).toMatch(/0\.79{2,}/);  // FP representation of ~0.8
    expect(p.evidence).toContain('rejection_rate=0.80');
    expect(p.evidence).toContain('approved=2');
    expect(p.evidence).toContain('rejected=8');
    expect(p.beforeValue).toEqual({ minConfidence: 0.7 });
    expect(p.afterValue).toEqual({ minConfidence: 0.7 + 0.1 }); // FP: 0.7999999999999999
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(0.9);
  });

  it('returns empty array when rejection rate is below 50%', async () => {
    approvedCount = 7;
    rejectedCount = 3; // 3/10 = 30% rejection rate

    const proposals = await analyzeMemoryQuality('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });

  it('returns empty array when total events < 5', async () => {
    approvedCount = 1;
    rejectedCount = 2; // total=3 < 5

    const proposals = await analyzeMemoryQuality('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });
});

afterAll(() => mock.restore());
