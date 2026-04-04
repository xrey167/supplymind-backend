import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod/v4';
import { executeWorkflow } from './workflows.engine';
import { dispatchSkill } from '../skills/skills.dispatch';
import type { WorkflowDispatchFn } from './workflows.types';

const workflowStepSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  when: z.string().optional(),
  label: z.string().optional(),
});

const runWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema).min(1),
  maxConcurrency: z.number().int().min(1).max(50).optional(),
  input: z.record(z.unknown()).optional(),
});

const runWorkflowRoute = createRoute({
  method: 'post',
  path: '/run',
  request: { body: { content: { 'application/json': { schema: runWorkflowSchema } } } },
  responses: { 200: { description: 'Workflow result', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

export const WorkflowRoutes = new OpenAPIHono();

WorkflowRoutes.openapi(runWorkflowRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;

  const dispatch: WorkflowDispatchFn = async (skillId, args, text) => {
    const mergedArgs = text ? { ...args, prompt: text } : args;
    const result = await dispatchSkill(skillId, mergedArgs, {
      callerId, workspaceId, callerRole: 'agent',
    });
    if (!result.ok) throw new Error(result.error.message);
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  };

  const result = await executeWorkflow(body, dispatch, body.input);
  return c.json(result);
});
