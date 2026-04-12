import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { credentialsService } from './credentials.service';
import { createCredentialSchema, updateCredentialSchema, credentialIdParamSchema, listCredentialsQuerySchema } from './credentials.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listCredentialsQuerySchema },
  responses: { 200: { description: 'List credentials', ...jsonRes } },
});

const getByIdRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: credentialIdParamSchema },
  responses: { 200: { description: 'Credential details', ...jsonRes }, 404: errRes('Not found') },
});

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createCredentialSchema } } } },
  responses: { 201: { description: 'Credential created', ...jsonRes }, 400: errRes('Bad request') },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{id}',
  request: { params: credentialIdParamSchema, body: { content: { 'application/json': { schema: updateCredentialSchema } } } },
  responses: { 200: { description: 'Credential updated', ...jsonRes }, 404: errRes('Not found') },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{id}',
  request: { params: credentialIdParamSchema },
  responses: { 200: { description: 'Credential deleted', ...jsonRes } },
});

export const CredentialsRoutes = new OpenAPIHono<AppEnv>();

CredentialsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') || query.workspaceId!;
  const credentials = await credentialsService.list(workspaceId);
  return c.json({ data: credentials });
});

CredentialsRoutes.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await credentialsService.getById(id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

CredentialsRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const result = await credentialsService.create({ ...body, workspaceId });
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

CredentialsRoutes.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await credentialsService.update(id, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

CredentialsRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  await credentialsService.delete(id);
  return c.json({ success: true }, 200);
});
