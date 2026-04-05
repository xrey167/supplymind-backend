import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { apiKeysService } from './api-keys.service';
import { toApiKeyResponse } from './api-keys.mapper';
import { emitApiKeyCreated, emitApiKeyRevoked, emitApiKeyDeleted } from './api-keys.events';
import { createApiKeySchema, apiKeyParamSchema, apiKeyResponseSchema, createApiKeyResponseSchema } from './api-keys.schemas';

const listRoute = createRoute({
  method: 'get',
  path: '/',
  responses: { 200: { description: 'List API keys', content: { 'application/json': { schema: z.object({ data: z.array(apiKeyResponseSchema) }) } } } },
});

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: createApiKeySchema } } } },
  responses: { 201: { description: 'API key created', content: { 'application/json': { schema: createApiKeyResponseSchema } } } },
});

const getRoute = createRoute({
  method: 'get',
  path: '/{keyId}',
  request: { params: apiKeyParamSchema },
  responses: {
    200: { description: 'API key details', content: { 'application/json': { schema: apiKeyResponseSchema } } },
    404: { description: 'Not found' },
  },
});

const revokeRoute = createRoute({
  method: 'post',
  path: '/{keyId}/revoke',
  request: { params: apiKeyParamSchema },
  responses: {
    200: { description: 'Key revoked', content: { 'application/json': { schema: z.object({ revoked: z.boolean() }) } } },
    404: { description: 'Not found' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{keyId}',
  request: { params: apiKeyParamSchema },
  responses: {
    200: { description: 'Key deleted', content: { 'application/json': { schema: z.object({ deleted: z.boolean() }) } } },
    404: { description: 'Not found' },
  },
});

export const ApiKeysRoutes = new OpenAPIHono();

ApiKeysRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const keys = await apiKeysService.list(workspaceId);
  return c.json({ data: keys.map(toApiKeyResponse) });
});

ApiKeysRoutes.openapi(createRoute_, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const input = c.req.valid('json');
  const result = await apiKeysService.create(workspaceId, input);
  emitApiKeyCreated(result.key.id, workspaceId, result.key.name);
  return c.json({ token: result.token, key: toApiKeyResponse(result.key) }, 201);
});

ApiKeysRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { keyId } = c.req.valid('param');
  const key = await apiKeysService.get(keyId, workspaceId);
  if (!key) return c.json({ error: 'API key not found' }, 404);
  return c.json(toApiKeyResponse(key));
});

ApiKeysRoutes.openapi(revokeRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { keyId } = c.req.valid('param');
  const revoked = await apiKeysService.revoke(keyId, workspaceId);
  if (!revoked) return c.json({ error: 'API key not found' }, 404);
  emitApiKeyRevoked(keyId, workspaceId);
  return c.json({ revoked: true });
});

ApiKeysRoutes.openapi(deleteRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { keyId } = c.req.valid('param');
  const deleted = await apiKeysService.deleteKey(keyId, workspaceId);
  if (!deleted) return c.json({ error: 'API key not found' }, 404);
  emitApiKeyDeleted(keyId, workspaceId);
  return c.json({ deleted: true });
});
