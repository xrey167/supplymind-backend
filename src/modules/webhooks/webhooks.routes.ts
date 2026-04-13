import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { webhooksService } from './webhooks.service';
import { CreateEndpointBodySchema, EndpointParamsSchema } from './webhooks.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

export const webhooksRoutes = new OpenAPIHono<AppEnv>();

webhooksRoutes.openapi(
  createRoute({ method: 'get', path: '/endpoints', responses: { 200: { description: 'List webhook endpoints', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const endpoints = await webhooksService.listEndpoints(workspaceId);
    return c.json({ data: endpoints });
  },
);

webhooksRoutes.openapi(
  createRoute({ method: 'post', path: '/endpoints', request: { body: { content: { 'application/json': { schema: CreateEndpointBodySchema } } } }, responses: { 201: { description: 'Endpoint created', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const callerId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const result = await webhooksService.createEndpoint({ workspaceId, createdBy: callerId, ...body });
    return c.json({ data: result }, 201);
  },
);

webhooksRoutes.openapi(
  createRoute({ method: 'delete', path: '/endpoints/:endpointId', request: { params: EndpointParamsSchema }, responses: { 204: { description: 'Endpoint deleted' } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { endpointId } = c.req.valid('param');
    await webhooksService.deleteEndpoint(endpointId, workspaceId);
    return new Response(null, { status: 204 });
  },
);

webhooksRoutes.openapi(
  createRoute({ method: 'get', path: '/endpoints/:endpointId/deliveries', request: { params: EndpointParamsSchema }, responses: { 200: { description: 'List deliveries', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { endpointId } = c.req.valid('param');
    const deliveries = await webhooksService.listDeliveries(endpointId, workspaceId);
    return c.json({ data: deliveries });
  },
);
