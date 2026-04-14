import { describe, it, expect, mock, beforeEach } from 'bun:test';

/* ------------------------------------------------------------------ */
/*  Mock: db.select().from(skillPerformanceMetrics).where(...)        */
/*  Returns an array of metric rows.                                  */
/* ------------------------------------------------------------------ */

let mockRows: any[] = [];

const mockWhere = mock(() => Promise.resolve(mockRows));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

const mockDb = { select: mockSelect } as any;

const { analyzeSkillWeights } = await import('../skill-weight-analyzer');

describe('analyzeSkillWeights', () => {
  beforeEach(() => {
    mockRows = [];
    mockWhere.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();

    // Re-apply implementations — mockClear only resets call history, not behavior
    mockWhere.mockImplementation(() => Promise.resolve(mockRows));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  it('produces a skill_weight proposal when failure rate > 30%', async () => {
    const recentWindow = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago (within 24h)
    mockRows = [{
      workspaceId: 'ws-1',
      pluginId: 'plugin-abc',
      skillId: 'fetch_orders',
      invocationCount: 10,
      failureCount: 5, // 50% failure rate
      lastFailureReason: 'timeout',
      windowStart: recentWindow,
    }];

    const proposals = await analyzeSkillWeights('ws-1', mockDb);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.workspaceId).toBe('ws-1');
    expect(p.pluginId).toBe('plugin-abc');
    expect(p.proposalType).toBe('skill_weight');
    expect(p.changeType).toBe('behavioral');
    expect(p.description).toContain('fetch_orders');
    expect(p.description).toContain('50%');
    expect(p.evidence).toContain('failure_rate=0.50');
    expect(p.evidence).toContain('invocations=10');
    expect(p.evidence).toContain('failures=5');
    expect(p.evidence).toContain('last_error=timeout');
    expect(p.beforeValue).toEqual({ skillId: 'fetch_orders', priority: 3 });
    expect(p.afterValue).toEqual({ skillId: 'fetch_orders', priority: 2 });
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(0.95);
  });

  it('returns empty array when failure rate is below 30%', async () => {
    const recentWindow = new Date(Date.now() - 1 * 60 * 60 * 1000);
    mockRows = [{
      workspaceId: 'ws-1',
      pluginId: 'plugin-abc',
      skillId: 'fetch_orders',
      invocationCount: 10,
      failureCount: 2, // 20% failure rate — below 30% threshold
      lastFailureReason: null,
      windowStart: recentWindow,
    }];

    const proposals = await analyzeSkillWeights('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });

  it('returns empty array when invocations < 5', async () => {
    const recentWindow = new Date(Date.now() - 1 * 60 * 60 * 1000);
    mockRows = [{
      workspaceId: 'ws-1',
      pluginId: 'plugin-abc',
      skillId: 'fetch_orders',
      invocationCount: 3, // below MIN_INVOCATIONS of 5
      failureCount: 3,    // 100% failure rate, but not enough data
      lastFailureReason: 'timeout',
      windowStart: recentWindow,
    }];

    const proposals = await analyzeSkillWeights('ws-1', mockDb);

    expect(proposals).toEqual([]);
  });
});
