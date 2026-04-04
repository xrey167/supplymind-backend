import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod/v4';
import { collaborate } from './collaboration.engine';
import { dispatchSkill } from '../skills/skills.dispatch';
import type { CollabDispatchFn } from './collaboration.types';

const collaborateSchema = z.object({
  strategy: z.enum(['fan_out', 'consensus', 'debate', 'map_reduce']),
  query: z.string().min(1),
  agents: z.array(z.string()).min(1),
  mergeStrategy: z.enum(['concat', 'best_score', 'majority_vote', 'custom']).optional(),
  maxRounds: z.number().int().min(1).max(10).optional(),
  items: z.array(z.unknown()).optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  judgeAgent: z.string().optional(),
  convergenceThreshold: z.number().min(0).max(1).optional(),
});

const collaborateRoute = createRoute({
  method: 'post',
  path: '/collaborate',
  request: { body: { content: { 'application/json': { schema: collaborateSchema } } } },
  responses: { 200: { description: 'Collaboration result', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

export const CollaborationRoutes = new OpenAPIHono();

CollaborationRoutes.openapi(collaborateRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;

  const dispatch: CollabDispatchFn = async (skillId, args) => {
    const result = await dispatchSkill(skillId, args as Record<string, unknown>, {
      callerId, workspaceId, callerRole: 'agent' as const,
    });
    if (!result.ok) throw new Error(result.error.message);
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  };

  const result = await collaborate(body, dispatch);
  return c.json(result);
});
