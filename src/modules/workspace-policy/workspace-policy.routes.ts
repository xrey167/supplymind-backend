import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { workspacePolicyService } from './workspace-policy.service';
import type { Policy } from './workspace-policy.types';
import {
  createPolicySchema,
  updatePolicySchema,
  policyParamSchema,
  policyResponseSchema,
} from './workspace-policy.schemas';

const listRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: {
      description: 'List workspace policies',
      content: { 'application/json': { schema: z.object({ data: z.array(policyResponseSchema) }) } },
    },
  },
});

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: createPolicySchema } } } },
  responses: {
    201: {
      description: 'Policy created',
      content: { 'application/json': { schema: policyResponseSchema } },
    },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/{policyId}',
  request: { params: policyParamSchema },
  responses: {
    200: {
      description: 'Policy details',
      content: { 'application/json': { schema: policyResponseSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/{policyId}',
  request: {
    params: policyParamSchema,
    body: { content: { 'application/json': { schema: updatePolicySchema } } },
  },
  responses: {
    200: {
      description: 'Policy updated',
      content: { 'application/json': { schema: policyResponseSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{policyId}',
  request: { params: policyParamSchema },
  responses: {
    200: {
      description: 'Policy deleted',
      content: { 'application/json': { schema: z.object({ deleted: z.boolean() }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
});

function toResponse(policy: Policy) {
  return { ...policy, createdAt: policy.createdAt.toISOString(), updatedAt: policy.updatedAt.toISOString() };
}

export const workspacePolicyRoutes = new OpenAPIHono<AppEnv>();

workspacePolicyRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const policies = await workspacePolicyService.list(workspaceId);
  return c.json({ data: policies.map(toResponse) });
});

workspacePolicyRoutes.openapi(createRoute_, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const input = c.req.valid('json');
  const policy = await workspacePolicyService.create(workspaceId, input);
  return c.json(toResponse(policy), 201);
});

workspacePolicyRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { policyId } = c.req.valid('param');
  const policy = await workspacePolicyService.getById(policyId, workspaceId);
  if (!policy) return c.json({ error: 'Policy not found' }, 404);
  return c.json(toResponse(policy), 200);
});

workspacePolicyRoutes.openapi(updateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { policyId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const policy = await workspacePolicyService.update(policyId, workspaceId, patch);
  if (!policy) return c.json({ error: 'Policy not found' }, 404);
  return c.json(toResponse(policy), 200);
});

workspacePolicyRoutes.openapi(deleteRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { policyId } = c.req.valid('param');
  const deleted = await workspacePolicyService.delete(policyId, workspaceId);
  if (!deleted) return c.json({ error: 'Policy not found' }, 404);
  return c.json({ deleted: true }, 200);
});
