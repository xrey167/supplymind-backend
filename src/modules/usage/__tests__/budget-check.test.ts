import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTotalCost = mock(() => Promise.resolve(0));
const mockGetTokenBudget = mock(() => Promise.resolve(null));

mock.module('../usage.repo', () => ({
  usageRepo: {
    totalCost: mockTotalCost,
    insert: mock(() => Promise.resolve()),
    sumByWorkspace: mock(() => Promise.resolve([])),
    sumByAgent: mock(() => Promise.resolve([])),
    listRecent: mock(() => Promise.resolve([])),
  },
}));

mock.module('../pricing', () => ({
  calculateCost: () => 0,
  resolveProvider: () => 'anthropic',
}));

mock.module('../../settings/workspace-settings/workspace-settings.service', () => ({
  workspaceSettingsService: {
    getTokenBudget: mockGetTokenBudget,
  },
}));

import { usageService } from '../usage.service';

describe('usageService.checkBudget', () => {
  beforeEach(() => {
    mockTotalCost.mockClear();
    mockGetTokenBudget.mockClear();
  });

  it('returns allowed=true when no budget is set', async () => {
    mockGetTokenBudget.mockResolvedValueOnce(null);

    const result = await usageService.checkBudget('ws-1');

    expect(result.allowed).toBe(true);
    expect(result.limitUsd).toBeNull();
  });

  it('returns allowed=true when under budget', async () => {
    mockGetTokenBudget.mockResolvedValueOnce({ monthlyLimitUsd: 10, warningThreshold: 0.8 });
    mockTotalCost.mockResolvedValueOnce(5);

    const result = await usageService.checkBudget('ws-1');

    expect(result.allowed).toBe(true);
    expect(result.usedUsd).toBe(5);
    expect(result.limitUsd).toBe(10);
    expect(result.pct).toBe(0.5);
  });

  it('returns allowed=false when over budget', async () => {
    mockGetTokenBudget.mockResolvedValueOnce({ monthlyLimitUsd: 10, warningThreshold: 0.8 });
    mockTotalCost.mockResolvedValueOnce(12);

    const result = await usageService.checkBudget('ws-1');

    expect(result.allowed).toBe(false);
    expect(result.pct).toBe(1.2);
  });

  it('returns correct warning threshold', async () => {
    mockGetTokenBudget.mockResolvedValueOnce({ monthlyLimitUsd: 100, warningThreshold: 0.9 });
    mockTotalCost.mockResolvedValueOnce(85);

    const result = await usageService.checkBudget('ws-1');

    expect(result.allowed).toBe(true);
    expect(result.warningThreshold).toBe(0.9);
    expect(result.pct).toBe(0.85);
  });
});
