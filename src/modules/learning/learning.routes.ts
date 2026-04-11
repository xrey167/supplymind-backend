/**
 * Learning Routes
 *
 * Exposes improvement proposals for workspace admins to review, approve,
 * reject, and rollback.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { improvementPipeline } from './improvement-pipeline';
import { trustTierService } from './trust-tier.service';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listProposalsRoute = createRoute({
  method: 'get',
  path: '/proposals',
  summary: 'List improvement proposals',
  responses: { 200: { description: 'Proposals', ...jsonRes } },
});

const approveProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/approve',
  summary: 'Approve an improvement proposal',
  request: { params: z.object({ proposalId: z.string() }) },
  responses: { 200: { description: 'Approved', ...jsonRes } },
});

const rejectProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/reject',
  summary: 'Reject an improvement proposal',
  request: { params: z.object({ proposalId: z.string() }) },
  responses: { 200: { description: 'Rejected', ...jsonRes } },
});

const rollbackProposalRoute = createRoute({
  method: 'post',
  path: '/proposals/{proposalId}/rollback',
  summary: 'Rollback an applied proposal',
  request: { params: z.object({ proposalId: z.string() }) },
  responses: { 200: { description: 'Rolled back', ...jsonRes } },
});

const getTrustTierRoute = createRoute({
  method: 'get',
  path: '/trust-tier',
  summary: 'Get learning trust tier config for workspace',
  responses: { 200: { description: 'Trust tier config', ...jsonRes } },
});

export function learningRoutes() {
  const app = new OpenAPIHono<{ Variables: { workspaceId: string } }>();

  app.openapi(listProposalsRoute, async (c) => {
    const workspaceId = c.req.param('workspaceId') ?? c.get('workspaceId');
    const proposals = await improvementPipeline.listPending(workspaceId);
    return c.json({
      proposals: proposals.map((p) => ({
        id: p.id,
        proposalType: p.proposalType,
        changeType: p.changeType,
        description: p.description,
        evidence: (p.evidence as string[]) ?? [],
        confidence: p.confidence,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  app.openapi(approveProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    await improvementPipeline.approve(proposalId);
    return c.json({ success: true });
  });

  app.openapi(rejectProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    await improvementPipeline.reject(proposalId);
    return c.json({ success: true });
  });

  app.openapi(rollbackProposalRoute, async (c) => {
    const { proposalId } = c.req.valid('param');
    await improvementPipeline.rollback(proposalId);
    return c.json({ success: true });
  });

  app.openapi(getTrustTierRoute, async (c) => {
    const workspaceId = c.req.param('workspaceId') ?? c.get('workspaceId');
    const config = await trustTierService.getTierConfig(workspaceId);
    return c.json(config);
  });

  return app;
}
