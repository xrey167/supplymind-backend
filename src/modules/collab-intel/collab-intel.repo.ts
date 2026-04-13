import { eq, and, desc, sql, asc } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import {
  collabBoards,
  collabBoardMembers,
  collabMentions,
  collabProposals,
  collabVotes,
  collabApprovalChains,
  collabApprovalSteps,
  collabActivities,
} from '../../infra/db/schema';
import type {
  CollabBoard,
  CollabBoardMember,
  CollabMention,
  CollabProposal,
  CollabVote,
  CollabApprovalChain,
  CollabApprovalStep,
  CollabActivity,
  CreateBoardInput,
  UpdateBoardInput,
  AddBoardMemberInput,
  CreateMentionInput,
  CreateProposalInput,
  CastVoteInput,
  CreateApprovalChainInput,
  CreateActivityInput,
} from './collab-intel.types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Boards ────────────────────────────────────────────────────────────────────

function toBoard(row: typeof collabBoards.$inferSelect): CollabBoard {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    visibility: row.visibility as CollabBoard['visibility'],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function createBoard(input: CreateBoardInput, tx?: Tx): Promise<CollabBoard> {
  const client = tx ?? db;
  const rows = await client.insert(collabBoards).values({
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    visibility: input.visibility ?? 'public',
    createdBy: input.createdBy,
  }).returning();
  return toBoard(rows[0]!);
}

async function listBoards(workspaceId: string): Promise<CollabBoard[]> {
  const rows = await db.select().from(collabBoards)
    .where(eq(collabBoards.workspaceId, workspaceId))
    .orderBy(desc(collabBoards.createdAt));
  return rows.map(toBoard);
}

async function getBoard(boardId: string): Promise<CollabBoard | null> {
  const rows = await db.select().from(collabBoards)
    .where(eq(collabBoards.id, boardId)).limit(1);
  return rows[0] ? toBoard(rows[0]) : null;
}

async function updateBoard(boardId: string, input: UpdateBoardInput): Promise<CollabBoard | null> {
  const rows = await db.update(collabBoards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(collabBoards.id, boardId))
    .returning();
  return rows[0] ? toBoard(rows[0]) : null;
}

async function deleteBoard(boardId: string): Promise<void> {
  await db.delete(collabBoards).where(eq(collabBoards.id, boardId));
}

// ── Board Members ─────────────────────────────────────────────────────────────

function toBoardMember(row: typeof collabBoardMembers.$inferSelect): CollabBoardMember {
  return { id: row.id, boardId: row.boardId, userId: row.userId, role: row.role, joinedAt: row.joinedAt };
}

async function addBoardMember(input: AddBoardMemberInput, tx?: Tx): Promise<CollabBoardMember> {
  const client = tx ?? db;
  const rows = await client.insert(collabBoardMembers).values({
    boardId: input.boardId,
    userId: input.userId,
    role: input.role ?? 'viewer',
  }).returning();
  return toBoardMember(rows[0]!);
}

async function removeBoardMember(boardId: string, userId: string): Promise<void> {
  await db.delete(collabBoardMembers)
    .where(and(eq(collabBoardMembers.boardId, boardId), eq(collabBoardMembers.userId, userId)));
}

async function listBoardMembers(boardId: string): Promise<CollabBoardMember[]> {
  const rows = await db.select().from(collabBoardMembers)
    .where(eq(collabBoardMembers.boardId, boardId));
  return rows.map(toBoardMember);
}

// ── Mentions ──────────────────────────────────────────────────────────────────

function toMention(row: typeof collabMentions.$inferSelect): CollabMention {
  return {
    id: row.id,
    boardId: row.boardId,
    mentionedUserId: row.mentionedUserId,
    mentionedByUserId: row.mentionedByUserId,
    contextText: row.contextText,
    status: row.status as CollabMention['status'],
    createdAt: row.createdAt,
  };
}

async function createMention(input: CreateMentionInput, tx?: Tx): Promise<CollabMention> {
  const client = tx ?? db;
  const rows = await client.insert(collabMentions).values(input).returning();
  return toMention(rows[0]!);
}

async function listMentions(boardId: string): Promise<CollabMention[]> {
  const rows = await db.select().from(collabMentions)
    .where(eq(collabMentions.boardId, boardId))
    .orderBy(desc(collabMentions.createdAt));
  return rows.map(toMention);
}

// ── Proposals ─────────────────────────────────────────────────────────────────

function toProposal(row: typeof collabProposals.$inferSelect): CollabProposal {
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    body: row.body,
    createdBy: row.createdBy,
    status: row.status as CollabProposal['status'],
    upVotes: row.upVotes,
    downVotes: row.downVotes,
    votingEndsAt: row.votingEndsAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function createProposal(input: CreateProposalInput, tx?: Tx): Promise<CollabProposal> {
  const client = tx ?? db;
  const rows = await client.insert(collabProposals).values({
    boardId: input.boardId,
    title: input.title,
    body: input.body,
    createdBy: input.createdBy,
    votingEndsAt: input.votingEndsAt ?? null,
  }).returning();
  return toProposal(rows[0]!);
}

async function listProposals(boardId: string): Promise<CollabProposal[]> {
  const rows = await db.select().from(collabProposals)
    .where(eq(collabProposals.boardId, boardId))
    .orderBy(desc(collabProposals.createdAt));
  return rows.map(toProposal);
}

async function getProposal(proposalId: string, tx?: Tx): Promise<CollabProposal | null> {
  const client = tx ?? db;
  const rows = await client.select().from(collabProposals)
    .where(eq(collabProposals.id, proposalId)).limit(1);
  return rows[0] ? toProposal(rows[0]) : null;
}

// ── Votes (atomic) ────────────────────────────────────────────────────────────

function toVote(row: typeof collabVotes.$inferSelect): CollabVote {
  return { id: row.id, proposalId: row.proposalId, userId: row.userId, voteType: row.voteType as CollabVote['voteType'], createdAt: row.createdAt };
}

async function getExistingVote(proposalId: string, userId: string, tx?: Tx): Promise<CollabVote | null> {
  const client = tx ?? db;
  const rows = await client.select().from(collabVotes)
    .where(and(eq(collabVotes.proposalId, proposalId), eq(collabVotes.userId, userId))).limit(1);
  return rows[0] ? toVote(rows[0]) : null;
}

async function upsertVote(input: CastVoteInput, tx?: Tx): Promise<{ upDelta: number; downDelta: number }> {
  const client = tx ?? db;
  const existing = await getExistingVote(input.proposalId, input.userId, tx);

  let upDelta = 0;
  let downDelta = 0;

  if (existing) {
    if (existing.voteType === input.voteType) return { upDelta: 0, downDelta: 0 }; // no change
    await client.update(collabVotes)
      .set({ voteType: input.voteType })
      .where(and(eq(collabVotes.proposalId, input.proposalId), eq(collabVotes.userId, input.userId)));
    if (existing.voteType === 'up' && input.voteType === 'down') { upDelta = -1; downDelta = 1; }
    else { upDelta = 1; downDelta = -1; }
  } else {
    await client.insert(collabVotes).values(input);
    if (input.voteType === 'up') { upDelta = 1; } else { downDelta = 1; }
  }

  await client.update(collabProposals)
    .set({
      upVotes: sql`${collabProposals.upVotes} + ${upDelta}`,
      downVotes: sql`${collabProposals.downVotes} + ${downDelta}`,
    })
    .where(eq(collabProposals.id, input.proposalId));

  return { upDelta, downDelta };
}

// ── Approval Chains ───────────────────────────────────────────────────────────

function toChain(row: typeof collabApprovalChains.$inferSelect): CollabApprovalChain {
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    description: row.description,
    createdBy: row.createdBy,
    status: row.status as CollabApprovalChain['status'],
    currentStep: row.currentStep,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStep(row: typeof collabApprovalSteps.$inferSelect): CollabApprovalStep {
  return {
    id: row.id,
    chainId: row.chainId,
    stepIndex: row.stepIndex,
    approverUserId: row.approverUserId,
    status: row.status as CollabApprovalStep['status'],
    comment: row.comment,
    respondedAt: row.respondedAt,
    createdAt: row.createdAt,
  };
}

async function createApprovalChain(input: CreateApprovalChainInput, tx?: Tx): Promise<{ chain: CollabApprovalChain; steps: CollabApprovalStep[] }> {
  const client = tx ?? db;
  const chainRows = await client.insert(collabApprovalChains).values({
    boardId: input.boardId,
    title: input.title,
    description: input.description ?? null,
    createdBy: input.createdBy,
  }).returning();
  const chain = toChain(chainRows[0]!);

  const stepValues = input.approverUserIds.map((approverUserId, stepIndex) => ({
    chainId: chain.id,
    stepIndex,
    approverUserId,
  }));
  const stepRows = await client.insert(collabApprovalSteps).values(stepValues).returning();
  const steps = stepRows.map(toStep);

  return { chain, steps };
}

async function listApprovalChains(boardId: string): Promise<CollabApprovalChain[]> {
  const rows = await db.select().from(collabApprovalChains)
    .where(eq(collabApprovalChains.boardId, boardId))
    .orderBy(desc(collabApprovalChains.createdAt));
  return rows.map(toChain);
}

async function getApprovalChain(chainId: string): Promise<CollabApprovalChain | null> {
  const rows = await db.select().from(collabApprovalChains)
    .where(eq(collabApprovalChains.id, chainId)).limit(1);
  return rows[0] ? toChain(rows[0]) : null;
}

async function getApprovalSteps(chainId: string): Promise<CollabApprovalStep[]> {
  const rows = await db.select().from(collabApprovalSteps)
    .where(eq(collabApprovalSteps.chainId, chainId))
    .orderBy(asc(collabApprovalSteps.stepIndex));
  return rows.map(toStep);
}

async function updateApprovalStep(stepId: string, update: { status: CollabApprovalStep['status']; comment?: string }): Promise<CollabApprovalStep | null> {
  const rows = await db.update(collabApprovalSteps)
    .set({ status: update.status, comment: update.comment ?? null, respondedAt: new Date() })
    .where(eq(collabApprovalSteps.id, stepId))
    .returning();
  return rows[0] ? toStep(rows[0]) : null;
}

async function updateApprovalChainStatus(chainId: string, status: string, currentStep?: number): Promise<CollabApprovalChain | null> {
  const rows = await db.update(collabApprovalChains)
    .set({ status, ...(currentStep !== undefined ? { currentStep } : {}), updatedAt: new Date() })
    .where(eq(collabApprovalChains.id, chainId))
    .returning();
  return rows[0] ? toChain(rows[0]) : null;
}

// ── Activities ────────────────────────────────────────────────────────────────

function toActivity(row: typeof collabActivities.$inferSelect): CollabActivity {
  return {
    id: row.id,
    boardId: row.boardId,
    actorUserId: row.actorUserId,
    activityType: row.activityType,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt,
  };
}

async function createActivity(input: CreateActivityInput): Promise<CollabActivity> {
  const rows = await db.insert(collabActivities).values({
    boardId: input.boardId,
    actorUserId: input.actorUserId,
    activityType: input.activityType,
    metadata: input.metadata ?? null,
  }).returning();
  return toActivity(rows[0]!);
}

async function listActivities(boardId: string, limit = 50): Promise<CollabActivity[]> {
  const rows = await db.select().from(collabActivities)
    .where(eq(collabActivities.boardId, boardId))
    .orderBy(desc(collabActivities.createdAt))
    .limit(limit);
  return rows.map(toActivity);
}

export const collabIntelRepo = {
  // boards
  createBoard,
  listBoards,
  getBoard,
  updateBoard,
  deleteBoard,
  // members
  addBoardMember,
  removeBoardMember,
  listBoardMembers,
  // mentions
  createMention,
  listMentions,
  // proposals
  createProposal,
  listProposals,
  getProposal,
  upsertVote,
  // approval chains
  createApprovalChain,
  listApprovalChains,
  getApprovalChain,
  getApprovalSteps,
  updateApprovalStep,
  updateApprovalChainStatus,
  // activities
  createActivity,
  listActivities,
};
