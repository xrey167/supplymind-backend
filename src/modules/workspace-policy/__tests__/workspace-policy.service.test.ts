import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the repo before importing the service
mock.module('../workspace-policy.repo', () => ({
  workspacePolicyRepo: {
    listForWorkspace: mock(async () => []),
    getById: mock(async () => null),
    create: mock(async (workspaceId: string, input: any) => ({
      id: 'p-new',
      workspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    })),
    update: mock(async () => null),
    delete: mock(async () => true),
  },
}));

const { workspacePolicyService } = await import('../workspace-policy.service');
const { workspacePolicyRepo } = await import('../workspace-policy.repo') as any;

beforeEach(() => {
  (workspacePolicyRepo.listForWorkspace as ReturnType<typeof mock>).mockReset();
  (workspacePolicyRepo.listForWorkspace as ReturnType<typeof mock>).mockImplementation(async () => []);
});

describe('workspacePolicyService.evaluate', () => {
  test('returns allowed=true when no policies exist', async () => {
    const verdict = await workspacePolicyService.evaluate('ws-1', {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tokensEstimated: 100,
      monthlyTokensUsed: 0,
      dailyTokensUsed: 0,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.policyPhase).toBe('passed');
  });

  test('returns allowed=false when budget policy is triggered', async () => {
    (workspacePolicyRepo.listForWorkspace as ReturnType<typeof mock>).mockImplementation(async () => [
      {
        id: 'p-1',
        workspaceId: 'ws-1',
        name: 'daily-cap',
        type: 'budget',
        enabled: true,
        priority: 1,
        conditions: {},
        actions: { max_daily_tokens: 100 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const verdict = await workspacePolicyService.evaluate('ws-1', {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tokensEstimated: 10,
      monthlyTokensUsed: 0,
      dailyTokensUsed: 500,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.policyPhase).toBe('budget');
  });

  test('returns allowed=false when access policy blocks model', async () => {
    (workspacePolicyRepo.listForWorkspace as ReturnType<typeof mock>).mockImplementation(async () => [
      {
        id: 'p-2',
        workspaceId: 'ws-1',
        name: 'block-gpt',
        type: 'access',
        enabled: true,
        priority: 1,
        conditions: { model_pattern: 'gpt-*' },
        actions: { block: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const verdict = await workspacePolicyService.evaluate('ws-1', {
      model: 'gpt-4o',
      provider: 'openai',
      tokensEstimated: 10,
      monthlyTokensUsed: 0,
      dailyTokensUsed: 0,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.policyPhase).toBe('access');
  });
});

describe('workspacePolicyService.create', () => {
  test('delegates to repo.create and returns policy', async () => {
    const input = {
      name: 'my-policy',
      type: 'budget' as const,
      enabled: true,
      priority: 5,
      conditions: {},
      actions: { max_daily_tokens: 1000 },
    };

    const policy = await workspacePolicyService.create('ws-1', input);
    expect(policy.id).toBe('p-new');
    expect(policy.name).toBe('my-policy');
  });
});
