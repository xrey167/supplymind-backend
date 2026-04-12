import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { executeWorkflow } from './workflows.engine';
import { dispatchSkill } from '../skills/skills.dispatch';
import type { WorkflowDispatchFn } from './workflows.types';
import { workflowsService } from './workflows.service';
import {
  createWorkflowTemplateSchema,
  updateWorkflowTemplateSchema,
  workflowTemplateIdParamSchema,
  runWorkflowTemplateSchema,
} from './workflows.schemas';

const workflowStepSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  when: z.string().optional(),
  label: z.string().optional(),
});

const runWorkflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema).optional(),
  definition: z.object({
    steps: z.array(workflowStepSchema).min(1),
    maxConcurrency: z.number().int().min(1).max(50).optional(),
  }).optional(),
  maxConcurrency: z.number().int().min(1).max(50).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

const runWorkflowRoute = createRoute({
  method: 'post',
  path: '/run',
  request: { body: { content: { 'application/json': { schema: runWorkflowSchema } } } },
  responses: { 200: { description: 'Workflow result', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const createTemplateRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createWorkflowTemplateSchema } } } },
  responses: { 201: { description: 'Created', ...jsonRes }, 400: errRes('Bad request') },
});

const listTemplatesRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List', ...jsonRes }, 500: errRes('Internal error') },
});

const getTemplateRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: workflowTemplateIdParamSchema },
  responses: { 200: { description: 'Template', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

const updateTemplateRoute = createRoute({
  method: 'patch', path: '/{id}',
  request: { params: workflowTemplateIdParamSchema, body: { content: { 'application/json': { schema: updateWorkflowTemplateSchema } } } },
  responses: { 200: { description: 'Updated', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

const deleteTemplateRoute = createRoute({
  method: 'delete', path: '/{id}',
  request: { params: workflowTemplateIdParamSchema },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found', ...jsonRes } },
});

const runTemplateRoute = createRoute({
  method: 'post', path: '/{id}/run',
  request: { params: workflowTemplateIdParamSchema, body: { content: { 'application/json': { schema: runWorkflowTemplateSchema } }, required: false } },
  responses: { 202: { description: 'Accepted', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

export const WorkflowRoutes = new OpenAPIHono<AppEnv>();

WorkflowRoutes.openapi(runWorkflowRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;

  const dispatch: WorkflowDispatchFn = async (skillId, args, text) => {
    const mergedArgs = text ? { ...args, prompt: text } : args;
    const result = await dispatchSkill(skillId, mergedArgs, {
      callerId, workspaceId, callerRole: 'agent' as const,
    });
    if (!result.ok) throw new Error(result.error.message);
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  };

  // Support both flat shape {id, steps} and nested {definition: {steps}}
  const steps = body.steps ?? body.definition?.steps ?? [];
  const workflowDef = {
    id: body.id ?? 'adhoc',
    name: body.name,
    description: body.description,
    steps,
    maxConcurrency: body.maxConcurrency ?? body.definition?.maxConcurrency,
  };
  const result = await executeWorkflow(workflowDef as any, dispatch, body.input);
  return c.json(result);
});

WorkflowRoutes.openapi(createTemplateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const body = c.req.valid('json');
  const result = await workflowsService.create(workspaceId, callerId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

WorkflowRoutes.openapi(listTemplatesRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const result = await workflowsService.list(workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json({ data: result.value });
});

WorkflowRoutes.openapi(getTemplateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await workflowsService.getById(id, workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

WorkflowRoutes.openapi(updateTemplateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await workflowsService.update(id, workspaceId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

WorkflowRoutes.openapi(deleteTemplateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await workflowsService.delete(id, workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.body(null, 204);
});

WorkflowRoutes.openapi(runTemplateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const body = (c.req.valid('json') ?? {}) as { sessionId?: string; input?: Record<string, unknown> };
  const result = await workflowsService.runTemplate(id, workspaceId, body.sessionId, body.input);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value }, 202);
});
