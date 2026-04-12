/**
 * Learning Routes
 *
 * Exposes improvement proposals for workspace admins to review, approve,
 * reject, and rollback. Also exposes trust tier management.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { improvementPipeline } from './improvement-pipeline';
import { trustTierService } from './trust-tier.service';
import {
  proposalIdParamSchema,
  listProposalsQuerySchema,
  proposalResponseSchema,
  trustTierResponseSchema,
  updateTrustTierBodySchema,
} from './learning.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listProposalsRoute = createRoute({
  method: 'get',
  path: '/proposals',
  summary: 'List improvement proposals',
  request: { query: listProposalsQuerySchema },
  responses: { 200: { description: 'Proposals', ...jsonRes } },
});

const getProposalRoute = createRoute({
  method: 'get',
  path: '/proposals/{proposalId}',
  summary: 'Get a single improvement proposal',
  request: { params: proposalIdParamSchema },
  responses: {
    200: { description: 'Proposal', ...jsonRes },
    404: { description: 'Not found', ...jsonRes },
  },
});

const approveProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/approve',
  summary: 'Approve an improvement proposal',
  request: { params: proposalIdParamSchema },
  responses: { 200: { description: 'Approved', ...jsonRes } },
});

const rejectProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/reject',
  summary: 'Reject an improvement proposal',
  request: { params: proposalIdParamSchema },
  responses: { 200: { description: 'Rejected', ...jsonRes } },
});

const rollbackProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/rollback',
  summary: 'Rollback an applied proposal',
  request: { params: proposalIdParamSchema },
  responses: { 200: { description: 'Rolled back', ...jsonRes } },
});

const getTrustTierRoute = createRoute({
  method: 'get',
  path: '/trust-tier',
  summary: 'Get learning trust tier config for workspace',
  responses: { 200: { description: 'Trust tier config', ...jsonRes } },
});

const updateTrustTierRoute = createRoute({
  method: 'put',
  path: '/trust-tier',
  summary: 'Update workspace learning trust tier',
  request: { body: { content: { 'application/json': { schema: updateTrustTierBodySchema } } } },
  responses: { 200: { description: 'Updated', ...jsonRes } },
});

export function learningRoutes() {
  const app = new OpenAPIHono<{ Variables: { workspaceId: string } }>();

  app.openapi(listProposalsRoute, async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    const query = c.req.valid('query');
    try {
      const proposals = await improvementPipeline.listFiltered(workspaceId, {
        status: query.status,
        proposalType: query.proposalType,
        since: query.since ? new Date(query.since) : undefined,
      });
      return c.json({ proposals });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.openapi(getProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    try {
      const proposal = await improvementPipeline.getById(proposalId);
      if (!proposal) return c.json({ error: 'Proposal not found' }, 404);
      return c.json(proposal);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.openapi(approveProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    try {
      await improvementPipeline.approve(proposalId);
      return c.json({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  app.openapi(rejectProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    try {
      await improvementPipeline.reject(proposalId);
      return c.json({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  app.openapi(rollbackProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    try {
      await improvementPipeline.rollback(proposalId);
      return c.json({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  app.openapi(getTrustTierRoute, async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    try {
      const config = await trustTierService.getTierConfig(workspaceId);
      return c.json(config);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.openapi(updateTrustTierRoute, async (c) => {
    const workspaceId = c.get('workspaceId') as string;
    const { tier } = c.req.valid('json');
    try {
      await trustTierService.setTier(workspaceId, tier);
      const config = await trustTierService.getTierConfig(workspaceId);
      return c.json(config);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  return app;
}
