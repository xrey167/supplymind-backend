import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { collabIntelService } from './collab-intel.service';
import {
  BoardParamsSchema,
  BoardMemberParamsSchema,
  ProposalParamsSchema,
  ApprovalParamsSchema,
  CreateBoardBodySchema,
  UpdateBoardBodySchema,
  AddBoardMemberBodySchema,
  CreateMentionBodySchema,
  CreateProposalBodySchema,
  CastVoteBodySchema,
  CreateApprovalChainBodySchema,
  RespondApprovalBodySchema,
} from './collab-intel.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

export const collabIntelRoutes = new OpenAPIHono<AppEnv>();

// ── Boards ────────────────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards', responses: { 200: { description: 'List boards', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const callerId = c.get('callerId') as string;
    const boards = await collabIntelService.listBoards(workspaceId, callerId);
    return c.json({ data: boards });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards', request: { body: { content: { 'application/json': { schema: CreateBoardBodySchema } } } }, responses: { 201: { description: 'Board created', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const board = await collabIntelService.createBoard({ ...body, workspaceId, createdBy: userId });
    return c.json({ data: board }, 201);
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards/:boardId', request: { params: BoardParamsSchema }, responses: { 200: { description: 'Get board', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const board = await collabIntelService.getBoard(boardId);
    return c.json({ data: board });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'put', path: '/boards/:boardId', request: { params: BoardParamsSchema, body: { content: { 'application/json': { schema: UpdateBoardBodySchema } } } }, responses: { 200: { description: 'Board updated', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const board = await collabIntelService.updateBoard(boardId, body, userId);
    return c.json({ data: board });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'delete', path: '/boards/:boardId', request: { params: BoardParamsSchema }, responses: { 204: { description: 'Board deleted' } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const userId = c.get('callerId') as string;
    await collabIntelService.deleteBoard(boardId, userId);
    return new Response(null, { status: 204 });
  },
);

// ── Board Members ─────────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/members', request: { params: BoardParamsSchema, body: { content: { 'application/json': { schema: AddBoardMemberBodySchema } } } }, responses: { 201: { description: 'Member added', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const callerId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const member = await collabIntelService.addBoardMember({ boardId, ...body }, callerId);
    return c.json({ data: member }, 201);
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'delete', path: '/boards/:boardId/members/:userId', request: { params: BoardMemberParamsSchema }, responses: { 204: { description: 'Member removed' } } }),
  async (c) => {
    const { boardId, userId } = c.req.valid('param');
    const callerId = c.get('callerId') as string;
    await collabIntelService.removeBoardMember(boardId, userId, callerId);
    return new Response(null, { status: 204 });
  },
);

// ── Mentions ──────────────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards/:boardId/mentions', request: { params: BoardParamsSchema }, responses: { 200: { description: 'List mentions', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const mentions = await collabIntelService.listMentions(boardId);
    return c.json({ data: mentions });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/mentions', request: { params: BoardParamsSchema, body: { content: { 'application/json': { schema: CreateMentionBodySchema } } } }, responses: { 201: { description: 'Mention created', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const workspaceId = c.get('workspaceId');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const mention = await collabIntelService.createMention(
      { boardId, mentionedByUserId: userId, ...body },
      workspaceId,
    );
    return c.json({ data: mention }, 201);
  },
);

// ── Proposals ─────────────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards/:boardId/proposals', request: { params: BoardParamsSchema }, responses: { 200: { description: 'List proposals', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const proposals = await collabIntelService.listProposals(boardId);
    return c.json({ data: proposals });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/proposals', request: { params: BoardParamsSchema, body: { content: { 'application/json': { schema: CreateProposalBodySchema } } } }, responses: { 201: { description: 'Proposal created', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const proposal = await collabIntelService.createProposal({
      boardId,
      title: body.title,
      body: body.body,
      createdBy: userId,
      votingEndsAt: body.votingEndsAt ? new Date(body.votingEndsAt) : undefined,
    });
    return c.json({ data: proposal }, 201);
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/proposals/:proposalId/vote', request: { params: ProposalParamsSchema, body: { content: { 'application/json': { schema: CastVoteBodySchema } } } }, responses: { 200: { description: 'Vote cast', ...jsonRes } } }),
  async (c) => {
    const { boardId, proposalId } = c.req.valid('param');
    const userId = c.get('callerId') as string;
    const { voteType } = c.req.valid('json');
    const proposal = await collabIntelService.castVote({ proposalId, userId, voteType }, boardId);
    return c.json({ data: proposal });
  },
);

// ── Approval Chains ───────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards/:boardId/approvals', request: { params: BoardParamsSchema }, responses: { 200: { description: 'List approval chains', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const chains = await collabIntelService.listApprovalChains(boardId);
    return c.json({ data: chains });
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/approvals', request: { params: BoardParamsSchema, body: { content: { 'application/json': { schema: CreateApprovalChainBodySchema } } } }, responses: { 201: { description: 'Approval chain created', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const workspaceId = c.get('workspaceId');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const result = await collabIntelService.createApprovalChain(
      { boardId, ...body, createdBy: userId },
      workspaceId,
    );
    return c.json({ data: result }, 201);
  },
);

collabIntelRoutes.openapi(
  createRoute({ method: 'post', path: '/boards/:boardId/approvals/:chainId/respond', request: { params: ApprovalParamsSchema, body: { content: { 'application/json': { schema: RespondApprovalBodySchema } } } }, responses: { 200: { description: 'Approval response recorded', ...jsonRes } } }),
  async (c) => {
    const { chainId, boardId } = c.req.valid('param');
    const workspaceId = c.get('workspaceId');
    const userId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const chain = await collabIntelService.respondApprovalStep(
      { chainId, callerId: userId, ...body },
      workspaceId,
      boardId,
    );
    return c.json({ data: chain });
  },
);

// ── Activity ──────────────────────────────────────────────────────────────────

collabIntelRoutes.openapi(
  createRoute({ method: 'get', path: '/boards/:boardId/activity', request: { params: BoardParamsSchema }, responses: { 200: { description: 'Activity feed', ...jsonRes } } }),
  async (c) => {
    const { boardId } = c.req.valid('param');
    const activities = await collabIntelService.listActivities(boardId);
    return c.json({ data: activities });
  },
);
