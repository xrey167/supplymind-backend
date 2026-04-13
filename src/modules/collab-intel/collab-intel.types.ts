export type BoardVisibility = 'public' | 'private';
export type MentionStatus = 'pending' | 'read' | 'dismissed';
export type CollabProposalStatus = 'open' | 'closed' | 'accepted' | 'rejected';
export type VoteType = 'up' | 'down';
export type ApprovalStepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
export type ApprovalChainStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CollabBoard {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  visibility: BoardVisibility;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollabBoardMember {
  id: string;
  boardId: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

export interface CollabMention {
  id: string;
  boardId: string;
  mentionedUserId: string;
  mentionedByUserId: string;
  contextText: string;
  status: MentionStatus;
  createdAt: Date;
}

export interface CollabProposal {
  id: string;
  boardId: string;
  title: string;
  body: string;
  createdBy: string;
  status: CollabProposalStatus;
  upVotes: number;
  downVotes: number;
  votingEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollabVote {
  id: string;
  proposalId: string;
  userId: string;
  voteType: VoteType;
  createdAt: Date;
}

export interface CollabApprovalChain {
  id: string;
  boardId: string;
  title: string;
  description: string | null;
  createdBy: string;
  status: ApprovalChainStatus;
  currentStep: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollabApprovalStep {
  id: string;
  chainId: string;
  stepIndex: number;
  approverUserId: string;
  status: ApprovalStepStatus;
  comment: string | null;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface CollabActivity {
  id: string;
  boardId: string;
  actorUserId: string;
  activityType: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface CreateBoardInput {
  workspaceId: string;
  title: string;
  description?: string;
  visibility?: BoardVisibility;
  createdBy: string;
}

export interface UpdateBoardInput {
  title?: string;
  description?: string;
  visibility?: BoardVisibility;
}

export interface AddBoardMemberInput {
  boardId: string;
  userId: string;
  role?: string;
}

export interface CreateMentionInput {
  boardId: string;
  mentionedUserId: string;
  mentionedByUserId: string;
  contextText: string;
}

export interface CreateProposalInput {
  boardId: string;
  title: string;
  body: string;
  createdBy: string;
  votingEndsAt?: Date;
}

export interface CastVoteInput {
  proposalId: string;
  userId: string;
  voteType: VoteType;
}

export interface CreateApprovalChainInput {
  boardId: string;
  title: string;
  description?: string;
  createdBy: string;
  approverUserIds: string[];
}

export interface RespondApprovalInput {
  chainId: string;
  callerId: string;
  decision: 'approved' | 'rejected';
  comment?: string;
}

export interface CreateActivityInput {
  boardId: string;
  actorUserId: string;
  activityType: string;
  metadata?: Record<string, unknown>;
}
