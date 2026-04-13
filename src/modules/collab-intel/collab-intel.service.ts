import { db } from '../../infra/db/client';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { notificationsService } from '../notifications/notifications.service';
import { inboxService } from '../inbox/inbox.service';
import { NotFoundError, ForbiddenError } from '../../core/errors';
import { collabIntelRepo } from './collab-intel.repo';
import type {
  CollabBoard,
  CollabBoardMember,
  CollabMention,
  CollabProposal,
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
  RespondApprovalInput,
} from './collab-intel.types';

// Fire-and-forget activity log — errors must not affect callers
function logActivity(boardId: string, actorUserId: string, activityType: string, metadata?: Record<string, unknown>): void {
  collabIntelRepo.createActivity({ boardId, actorUserId, activityType, metadata }).catch(() => { /* intentionally swallowed */ });
}

class CollabIntelService {
  // ── Boards ──────────────────────────────────────────────────────────────────

  async createBoard(input: CreateBoardInput): Promise<CollabBoard> {
    const board = await collabIntelRepo.createBoard(input);
    // Add creator as owner member
    await collabIntelRepo.addBoardMember({ boardId: board.id, userId: input.createdBy, role: 'owner' });
    eventBus.publish(Topics.COLLAB_INTEL_BOARD_CREATED, { boardId: board.id, workspaceId: input.workspaceId }).catch(() => {});
    logActivity(board.id, input.createdBy, 'board_created', { title: board.title });
    return board;
  }

  async listBoards(workspaceId: string): Promise<CollabBoard[]> {
    return collabIntelRepo.listBoards(workspaceId);
  }

  async getBoard(boardId: string): Promise<CollabBoard> {
    const board = await collabIntelRepo.getBoard(boardId);
    if (!board) throw new NotFoundError(`Board ${boardId} not found`);
    return board;
  }

  async updateBoard(boardId: string, input: UpdateBoardInput, callerId: string): Promise<CollabBoard> {
    const board = await collabIntelRepo.updateBoard(boardId, input);
    if (!board) throw new NotFoundError(`Board ${boardId} not found`);
    eventBus.publish(Topics.COLLAB_INTEL_BOARD_UPDATED, { boardId }).catch(() => {});
    logActivity(boardId, callerId, 'board_updated', input as Record<string, unknown>);
    return board;
  }

  async deleteBoard(boardId: string, callerId: string): Promise<void> {
    const board = await collabIntelRepo.getBoard(boardId);
    if (!board) throw new NotFoundError(`Board ${boardId} not found`);
    await collabIntelRepo.deleteBoard(boardId);
    eventBus.publish(Topics.COLLAB_INTEL_BOARD_DELETED, { boardId, workspaceId: board.workspaceId }).catch(() => {});
    // Board cascade-deletes all child rows, so no activity log needed
    void callerId; // used for future auth checks
  }

  // ── Board Members ───────────────────────────────────────────────────────────

  async addBoardMember(input: AddBoardMemberInput, callerId: string): Promise<CollabBoardMember> {
    const member = await collabIntelRepo.addBoardMember(input);
    eventBus.publish(Topics.COLLAB_INTEL_MEMBER_ADDED, { boardId: input.boardId, userId: input.userId }).catch(() => {});
    logActivity(input.boardId, callerId, 'member_added', { userId: input.userId, role: input.role });
    return member;
  }

  async removeBoardMember(boardId: string, userId: string, callerId: string): Promise<void> {
    await collabIntelRepo.removeBoardMember(boardId, userId);
    eventBus.publish(Topics.COLLAB_INTEL_MEMBER_REMOVED, { boardId, userId }).catch(() => {});
    logActivity(boardId, callerId, 'member_removed', { userId });
  }

  async listBoardMembers(boardId: string): Promise<CollabBoardMember[]> {
    return collabIntelRepo.listBoardMembers(boardId);
  }

  // ── Mentions ────────────────────────────────────────────────────────────────

  async createMention(input: CreateMentionInput, workspaceId: string): Promise<CollabMention> {
    const mention = await collabIntelRepo.createMention(input);

    // Notify the mentioned user
    notificationsService.notify({
      workspaceId,
      userId: input.mentionedUserId,
      type: 'collab_mention',
      title: 'You were mentioned in a board',
      body: input.contextText,
      metadata: { boardId: input.boardId, mentionId: mention.id },
    }).catch(() => {});

    inboxService.add({
      workspaceId,
      userId: input.mentionedUserId,
      type: 'notification',
      title: 'You were mentioned in a board',
      body: input.contextText,
      metadata: { boardId: input.boardId, mentionId: mention.id },
      sourceType: 'collab_mention',
      sourceId: mention.id,
    }).catch(() => {});

    eventBus.publish(Topics.COLLAB_INTEL_MENTION_CREATED, { mentionId: mention.id, boardId: input.boardId }).catch(() => {});
    logActivity(input.boardId, input.mentionedByUserId, 'mention_created', { mentionedUserId: input.mentionedUserId });
    return mention;
  }

  async listMentions(boardId: string): Promise<CollabMention[]> {
    return collabIntelRepo.listMentions(boardId);
  }

  // ── Proposals ───────────────────────────────────────────────────────────────

  async createProposal(input: CreateProposalInput): Promise<CollabProposal> {
    const proposal = await collabIntelRepo.createProposal(input);
    eventBus.publish(Topics.COLLAB_INTEL_PROPOSAL_CREATED, { proposalId: proposal.id, boardId: input.boardId }).catch(() => {});
    logActivity(input.boardId, input.createdBy, 'proposal_created', { title: proposal.title });
    return proposal;
  }

  async listProposals(boardId: string): Promise<CollabProposal[]> {
    return collabIntelRepo.listProposals(boardId);
  }

  async castVote(input: CastVoteInput, boardId: string): Promise<CollabProposal> {
    await db.transaction(async (tx) => {
      await collabIntelRepo.upsertVote(input, tx);
    });
    const proposal = await collabIntelRepo.getProposal(input.proposalId);
    if (!proposal) throw new NotFoundError(`Proposal ${input.proposalId} not found`);
    eventBus.publish(Topics.COLLAB_INTEL_VOTE_CAST, { proposalId: input.proposalId, userId: input.userId, voteType: input.voteType }).catch(() => {});
    logActivity(boardId, input.userId, 'vote_cast', { proposalId: input.proposalId, voteType: input.voteType });
    return proposal;
  }

  // ── Approval Chains ─────────────────────────────────────────────────────────

  async createApprovalChain(input: CreateApprovalChainInput, workspaceId: string): Promise<{ chain: CollabApprovalChain; steps: CollabApprovalStep[] }> {
    const result = await db.transaction(async (tx) => {
      return collabIntelRepo.createApprovalChain(input, tx);
    });

    const { chain, steps } = result;

    // Notify the first approver
    const firstApprover = steps[0];
    if (firstApprover) {
      notificationsService.notify({
        workspaceId,
        userId: firstApprover.approverUserId,
        type: 'collab_approval_requested',
        title: `Approval requested: ${chain.title}`,
        body: chain.description ?? undefined,
        metadata: { chainId: chain.id, boardId: input.boardId, stepIndex: 0 },
      }).catch(() => {});

      inboxService.add({
        workspaceId,
        userId: firstApprover.approverUserId,
        type: 'notification',
        title: `Approval requested: ${chain.title}`,
        body: chain.description ?? undefined,
        metadata: { chainId: chain.id, boardId: input.boardId, stepIndex: 0 },
        sourceType: 'collab_approval_chain',
        sourceId: chain.id,
      }).catch(() => {});
    }

    eventBus.publish(Topics.COLLAB_INTEL_APPROVAL_CHAIN_CREATED, { chainId: chain.id, boardId: input.boardId }).catch(() => {});
    logActivity(input.boardId, input.createdBy, 'approval_chain_created', { chainId: chain.id, title: chain.title });
    return result;
  }

  async listApprovalChains(boardId: string): Promise<CollabApprovalChain[]> {
    return collabIntelRepo.listApprovalChains(boardId);
  }

  async respondApprovalStep(input: RespondApprovalInput, workspaceId: string): Promise<CollabApprovalChain> {
    const chain = await collabIntelRepo.getApprovalChain(input.chainId);
    if (!chain) throw new NotFoundError(`Approval chain ${input.chainId} not found`);
    if (chain.status !== 'pending') throw new ForbiddenError(`Chain is already ${chain.status}`);

    const steps = await collabIntelRepo.getApprovalSteps(input.chainId);
    const currentStep = steps[chain.currentStep];
    if (!currentStep) throw new NotFoundError('Current step not found');
    if (currentStep.approverUserId !== input.callerId) {
      throw new ForbiddenError('You are not the approver for the current step');
    }

    await collabIntelRepo.updateApprovalStep(currentStep.id, {
      status: input.decision,
      comment: input.comment,
    });

    eventBus.publish(Topics.COLLAB_INTEL_APPROVAL_STEP_RESPONDED, {
      chainId: input.chainId,
      stepIndex: chain.currentStep,
      decision: input.decision,
    }).catch(() => {});

    let updatedChain: CollabApprovalChain;

    if (input.decision === 'rejected') {
      updatedChain = (await collabIntelRepo.updateApprovalChainStatus(input.chainId, 'rejected'))!;
      // Notify creator
      notificationsService.notify({
        workspaceId,
        userId: chain.createdBy,
        type: 'collab_approval_requested',
        title: `Approval chain rejected: ${chain.title}`,
        body: input.comment,
        metadata: { chainId: chain.id, decision: 'rejected' },
      }).catch(() => {});
      eventBus.publish(Topics.COLLAB_INTEL_APPROVAL_CHAIN_RESOLVED, { chainId: chain.id, status: 'rejected' }).catch(() => {});
    } else {
      const nextStepIndex = chain.currentStep + 1;
      if (nextStepIndex < steps.length) {
        // Advance to next step
        updatedChain = (await collabIntelRepo.updateApprovalChainStatus(input.chainId, 'pending', nextStepIndex))!;
        const nextStep = steps[nextStepIndex]!;
        notificationsService.notify({
          workspaceId,
          userId: nextStep.approverUserId,
          type: 'collab_approval_requested',
          title: `Approval requested: ${chain.title}`,
          body: chain.description ?? undefined,
          metadata: { chainId: chain.id, boardId: chain.boardId, stepIndex: nextStepIndex },
        }).catch(() => {});
        inboxService.add({
          workspaceId,
          userId: nextStep.approverUserId,
          type: 'notification',
          title: `Approval requested: ${chain.title}`,
          metadata: { chainId: chain.id, stepIndex: nextStepIndex },
          sourceType: 'collab_approval_chain',
          sourceId: chain.id,
        }).catch(() => {});
      } else {
        // All steps approved
        updatedChain = (await collabIntelRepo.updateApprovalChainStatus(input.chainId, 'approved'))!;
        notificationsService.notify({
          workspaceId,
          userId: chain.createdBy,
          type: 'collab_approval_requested',
          title: `Approval chain approved: ${chain.title}`,
          metadata: { chainId: chain.id, decision: 'approved' },
        }).catch(() => {});
        eventBus.publish(Topics.COLLAB_INTEL_APPROVAL_CHAIN_RESOLVED, { chainId: chain.id, status: 'approved' }).catch(() => {});
      }
    }

    logActivity(chain.boardId, input.callerId, 'approval_step_responded', { chainId: chain.id, decision: input.decision });
    return updatedChain;
  }

  // ── Activity ────────────────────────────────────────────────────────────────

  async listActivities(boardId: string): Promise<CollabActivity[]> {
    return collabIntelRepo.listActivities(boardId);
  }
}

export const collabIntelService = new CollabIntelService();
