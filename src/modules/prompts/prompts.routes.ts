import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { promptsService } from './prompts.service';
import {
  createPromptSchema,
  updatePromptSchema,
  promptIdParamSchema,
  listPromptsQuerySchema,
  renderPromptSchema,
} from './prompts.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listPromptsQuerySchema },
  responses: { 200: { description: 'List prompts', ...jsonRes } },
});

const getByIdRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: promptIdParamSchema },
  responses: { 200: { description: 'Prompt details', ...jsonRes } },
});

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createPromptSchema } } } },
  responses: { 201: { description: 'Prompt created', ...jsonRes } },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{id}',
  request: { params: promptIdParamSchema, body: { content: { 'application/json': { schema: updatePromptSchema } } } },
  responses: { 200: { description: 'Prompt updated', ...jsonRes } },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{id}',
  request: { params: promptIdParamSchema },
  responses: { 200: { description: 'Prompt deleted', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

const renderRoute = createRoute({
  method: 'post', path: '/{id}/render',
  request: { params: promptIdParamSchema, body: { content: { 'application/json': { schema: renderPromptSchema } } } },
  responses: { 200: { description: 'Rendered prompt', ...jsonRes } },
});

export const PromptsRoutes = new OpenAPIHono();

PromptsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = (c.get('workspaceId') as string) ?? query.workspaceId;
  const prompts = await promptsService.list(workspaceId, {
    tag: query.tag,
    isActive: query.isActive,
    limit: query.limit,
    offset: query.offset,
  });
  return c.json({ data: prompts });
});

PromptsRoutes.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await promptsService.get(id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

PromptsRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = (c.get('workspaceId') as string) ?? body.workspaceId;
  const result = await promptsService.create({ ...body, workspaceId });
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

PromptsRoutes.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await promptsService.update(id, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

PromptsRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await promptsService.delete(id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ success: true });
});

PromptsRoutes.openapi(renderRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await promptsService.render(id, body.variables);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: { rendered: result.value } });
});
