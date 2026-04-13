import { z } from 'zod';

export const CreateBoardBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const UpdateBoardBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

export const AddBoardMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['owner', 'editor', 'viewer']).default('viewer'),
});

export const CreateMentionBodySchema = z.object({
  mentionedUserId: z.string().min(1),
  contextText: z.string().min(1).max(1000),
});

export const CreateProposalBodySchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  votingEndsAt: z.string().datetime().optional(),
});

export const CastVoteBodySchema = z.object({
  voteType: z.enum(['up', 'down']),
});

export const CreateApprovalChainBodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  approverUserIds: z.array(z.string().min(1)).min(1).max(20),
});

export const RespondApprovalBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
});

export const BoardParamsSchema = z.object({
  boardId: z.string().uuid(),
});

export const BoardMemberParamsSchema = z.object({
  boardId: z.string().uuid(),
  userId: z.string().min(1),
});

export const ProposalParamsSchema = z.object({
  boardId: z.string().uuid(),
  proposalId: z.string().uuid(),
});

export const ApprovalParamsSchema = z.object({
  boardId: z.string().uuid(),
  chainId: z.string().uuid(),
});
