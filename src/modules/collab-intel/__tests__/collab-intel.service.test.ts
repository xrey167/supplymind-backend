import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ── Mock function handles ─────────────────────────────────────────────────────

const mockDbTransaction = mock(async (fn: Function) => fn({}));
const mockBusPublish = mock(async () => {});
const mockNotify = mock(async () => null);
const mockInboxAdd = mock(async () => ({}));

const mockRepo = {
  createBoard: mock(async (input: any) => ({
    id: 'board-1',
    workspaceId: input.workspaceId,
    title: input.title,
    description: null,
    visibility: 'public',
    createdBy: input.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  listBoards: mock(async () => []),
  getBoard: mock(async (id: string) => ({
    id,
    workspaceId: 'ws-1',
    title: 'Test Board',
    description: null,
    visibility: 'public',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateBoard: mock(async (id: string, input: any) => ({
    id,
    workspaceId: 'ws-1',
    title: input.title ?? 'Test Board',
    description: null,
    visibility: 'public',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  deleteBoard: mock(async () => {}),
  getBoardMember: mock(async () => ({
    id: 'mem-1', boardId: 'board-1', userId: 'user-1', role: 'owner', joinedAt: new Date(),
  })),
  addBoardMember: mock(async (input: any) => ({
    id: 'mem-1',
    boardId: input.boardId,
    userId: input.userId,
    role: input.role ?? 'viewer',
    joinedAt: new Date(),
  })),
  removeBoardMember: mock(async () => {}),
  listBoardMembers: mock(async () => []),
  createMention: mock(async (input: any) => ({
    id: 'mention-1',
    boardId: input.boardId,
    mentionedUserId: input.mentionedUserId,
    mentionedByUserId: input.mentionedByUserId,
    contextText: input.contextText,
    status: 'pending',
    createdAt: new Date(),
  })),
  listMentions: mock(async () => []),
  createProposal: mock(async (input: any) => ({
    id: 'prop-1',
    boardId: input.boardId,
    title: input.title,
    body: input.body,
    createdBy: input.createdBy,
    status: 'open',
    upVotes: 0,
    downVotes: 0,
    votingEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  listProposals: mock(async () => []),
  getProposal: mock(async (id: string) => ({
    id,
    boardId: 'board-1',
    title: 'Prop',
    body: 'body',
    createdBy: 'user-1',
    status: 'open',
    upVotes: 1,
    downVotes: 0,
    votingEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  upsertVote: mock(async () => ({ upDelta: 1, downDelta: 0 })),
  createApprovalChain: mock(async (input: any) => ({
    chain: {
      id: 'chain-1',
      boardId: input.boardId,
      title: input.title,
      description: null,
      createdBy: input.createdBy,
      status: 'pending',
      currentStep: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    steps: (input.approverUserIds as string[]).map((uid, i) => ({
      id: `step-${i}`,
      chainId: 'chain-1',
      stepIndex: i,
      approverUserId: uid,
      status: 'pending',
      comment: null,
      respondedAt: null,
      createdAt: new Date(),
    })),
  })),
  listApprovalChains: mock(async () => []),
  getApprovalChain: mock(async (id: string) => ({
    id,
    boardId: 'board-1',
    title: 'Chain',
    description: null,
    createdBy: 'user-creator',
    status: 'pending',
    currentStep: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getApprovalSteps: mock(async () => [
    { id: 'step-0', chainId: 'chain-1', stepIndex: 0, approverUserId: 'approver-1', status: 'pending', comment: null, respondedAt: null, createdAt: new Date() },
    { id: 'step-1', chainId: 'chain-1', stepIndex: 1, approverUserId: 'approver-2', status: 'pending', comment: null, respondedAt: null, createdAt: new Date() },
  ]),
  updateApprovalStep: mock(async (id: string, update: any) => ({
    id,
    chainId: 'chain-1',
    stepIndex: 0,
    approverUserId: 'approver-1',
    status: update.status,
    comment: update.comment ?? null,
    respondedAt: new Date(),
    createdAt: new Date(),
  })),
  updateApprovalChainStatus: mock(async (id: string, status: string, currentStep?: number) => ({
    id,
    boardId: 'board-1',
    title: 'Chain',
    description: null,
    createdBy: 'user-creator',
    status,
    currentStep: currentStep ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  createActivity: mock(async () => ({
    id: 'act-1',
    boardId: 'board-1',
    actorUserId: 'user-1',
    activityType: 'test',
    metadata: null,
    createdAt: new Date(),
  })),
  listActivities: mock(async () => []),
};

// ── Module mocks — using require()+spread to avoid polluting shared modules ───
// Paths below are relative to THIS file: src/modules/collab-intel/__tests__/

// 1. DB client — mock transaction; spread real exports so other code still works
const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    ..._realDbClient.db,
    transaction: mockDbTransaction,
  },
}));

// 2. Collab repo — full replacement (only this module uses it)
mock.module('../collab-intel.repo', () => ({
  collabIntelRepo: mockRepo,
}));

// 3. Event bus — spread real module, proxy only `publish` so other tests still work
const _realBus = require('../../../events/bus');
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: any) {
      if (prop === 'publish') return mockBusPublish;
      return target[prop];
    },
  }),
}));

// 4. Notifications service — spread real module, override singleton's notify only
const _realNotifModule = require('../../notifications/notifications.service');
mock.module('../../notifications/notifications.service', () => ({
  ..._realNotifModule,
  notificationsService: { ..._realNotifModule.notificationsService, notify: mockNotify },
}));

// 5. Inbox service — spread real module, override singleton's add only
const _realInboxModule = require('../../inbox/inbox.service');
mock.module('../../inbox/inbox.service', () => ({
  ..._realInboxModule,
  inboxService: { ..._realInboxModule.inboxService, add: mockInboxAdd },
}));

// NOTE: events/topics is NOT mocked — the real module has all COLLAB_INTEL_* topics
// and mocking it with a subset would break other test files.

// Load service AFTER all mocks are registered
const { collabIntelService } = await import('../collab-intel.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearAllMocks() {
  mockDbTransaction.mockClear();
  mockBusPublish.mockClear();
  mockNotify.mockClear();
  mockInboxAdd.mockClear();
  (Object.values(mockRepo) as ReturnType<typeof mock>[]).forEach((m) => m.mockClear());
}

beforeEach(clearAllMocks);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CollabIntelService.createBoard', () => {
  it('returns created board and emits COLLAB_INTEL_BOARD_CREATED', async () => {
    const board = await collabIntelService.createBoard({
      workspaceId: 'ws-1',
      title: 'My Board',
      createdBy: 'user-1',
    });

    expect(board.title).toBe('My Board');
    expect(mockRepo.createBoard).toHaveBeenCalledTimes(1);
    expect(mockRepo.addBoardMember).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'board-1', role: 'owner' }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.board.created',
      expect.objectContaining({ boardId: 'board-1' }),
    );
  });
});

describe('CollabIntelService.createMention', () => {
  it('notifies mentioned user, adds inbox item, and emits event', async () => {
    const mention = await collabIntelService.createMention(
      { boardId: 'board-1', mentionedUserId: 'user-target', mentionedByUserId: 'user-1', contextText: '@user-target look here' },
      'ws-1',
    );

    expect(mention.mentionedUserId).toBe('user-target');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'collab_mention', userId: 'user-target' }),
    );
    expect(mockInboxAdd).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-target', sourceType: 'collab_mention' }),
    );
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.mention.created',
      expect.objectContaining({ mentionId: 'mention-1' }),
    );
  });
});

describe('CollabIntelService.castVote', () => {
  it('new up vote — runs in transaction, returns updated proposal, emits event', async () => {
    mockRepo.upsertVote.mockImplementation(async () => ({ upDelta: 1, downDelta: 0 }));
    const proposal = await collabIntelService.castVote(
      { proposalId: 'prop-1', userId: 'user-1', voteType: 'up' },
      'board-1',
    );

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(proposal.id).toBe('prop-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.vote.cast',
      expect.objectContaining({ voteType: 'up' }),
    );
  });

  it('changing vote from up to down — upsertVote called with down type', async () => {
    mockRepo.upsertVote.mockImplementation(async () => ({ upDelta: -1, downDelta: 1 }));
    await collabIntelService.castVote({ proposalId: 'prop-1', userId: 'user-1', voteType: 'down' }, 'board-1');
    expect(mockRepo.upsertVote).toHaveBeenCalledWith(
      { proposalId: 'prop-1', userId: 'user-1', voteType: 'down' },
      expect.anything(),
    );
  });
});

describe('CollabIntelService.createApprovalChain', () => {
  it('runs in transaction, notifies step[0] approver, emits COLLAB_INTEL_APPROVAL_CHAIN_CREATED', async () => {
    await collabIntelService.createApprovalChain(
      { boardId: 'board-1', title: 'Budget Approval', approverUserIds: ['approver-1', 'approver-2'], createdBy: 'user-1' },
      'ws-1',
    );

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'collab_approval_requested', userId: 'approver-1' }),
    );
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.approval.chain.created',
      expect.objectContaining({ chainId: 'chain-1' }),
    );
  });
});

describe('CollabIntelService.respondApprovalStep', () => {
  it('approved with more steps — advances currentStep, notifies next approver', async () => {
    const updatedChain = await collabIntelService.respondApprovalStep(
      { chainId: 'chain-1', callerId: 'approver-1', decision: 'approved' },
      'ws-1',
      'board-1',
    );

    expect(mockRepo.updateApprovalChainStatus).toHaveBeenCalledWith('chain-1', 'pending', 1);
    expect(updatedChain.currentStep).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'approver-2', type: 'collab_approval_requested' }),
    );
    expect(mockBusPublish).not.toHaveBeenCalledWith('collab-intel.approval.chain.resolved', expect.anything());
  });

  it('approved on last step — chain becomes approved, notifies creator, emits RESOLVED', async () => {
    mockRepo.getApprovalSteps.mockImplementation(async () => [
      { id: 'step-0', chainId: 'chain-1', stepIndex: 0, approverUserId: 'approver-1', status: 'pending', comment: null, respondedAt: null, createdAt: new Date() },
    ]);

    const updatedChain = await collabIntelService.respondApprovalStep(
      { chainId: 'chain-1', callerId: 'approver-1', decision: 'approved' },
      'ws-1',
      'board-1',
    );

    expect(mockRepo.updateApprovalChainStatus).toHaveBeenCalledWith('chain-1', 'approved');
    expect(updatedChain.status).toBe('approved');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-creator', type: 'collab_approval_resolved' }));
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.approval.chain.resolved',
      expect.objectContaining({ status: 'approved' }),
    );
  });

  it('rejected — chain becomes rejected, notifies creator, emits RESOLVED', async () => {
    mockRepo.getApprovalSteps.mockImplementation(async () => [
      { id: 'step-0', chainId: 'chain-1', stepIndex: 0, approverUserId: 'approver-1', status: 'pending', comment: null, respondedAt: null, createdAt: new Date() },
    ]);

    const updatedChain = await collabIntelService.respondApprovalStep(
      { chainId: 'chain-1', callerId: 'approver-1', decision: 'rejected', comment: 'Not ready' },
      'ws-1',
      'board-1',
    );

    expect(mockRepo.updateApprovalChainStatus).toHaveBeenCalledWith('chain-1', 'rejected');
    expect(updatedChain.status).toBe('rejected');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockBusPublish).toHaveBeenCalledWith(
      'collab-intel.approval.chain.resolved',
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-creator', type: 'collab_approval_resolved' }));
  });
});
