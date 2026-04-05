import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { skillsService } from './skills.service';
import { invokeSkillBodySchema, skillNameParamSchema } from './skills.schemas';
import { Roles } from '../../core/security';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List available skills', ...jsonRes } },
});

const describeRoute = createRoute({
  method: 'get', path: '/{name}',
  request: { params: skillNameParamSchema },
  responses: { 200: { description: 'Skill details', ...jsonRes } },
});

const invokeRoute = createRoute({
  method: 'post', path: '/{name}/invoke',
  request: { params: skillNameParamSchema, body: { content: { 'application/json': { schema: invokeSkillBodySchema } } } },
  responses: { 200: { description: 'Skill result', ...jsonRes } },
});

export const SkillsRoutes = new OpenAPIHono();

SkillsRoutes.openapi(listRoute, async (c) => {
  const skills = skillsService.listSkills();
  return c.json({ data: skills.map(({ handler, ...rest }) => rest) });
});

SkillsRoutes.openapi(describeRoute, async (c) => {
  const { name } = c.req.valid('param');
  const skill = skillsService.describeSkill(name);
  if (!skill) return c.json({ error: `Skill not found: ${name}` }, 404);
  const { handler, ...rest } = skill;
  return c.json({ data: rest });
});

SkillsRoutes.openapi(invokeRoute, async (c) => {
  const { name } = c.req.valid('param');
  const { args } = c.req.valid('json');
  const context = {
    callerId: c.get('callerId') ?? 'anonymous',
    workspaceId: c.get('workspaceId') ?? 'default',
    callerRole: c.get('callerRole') ?? Roles.VIEWER,
  };
  const result = await skillsService.invokeSkill(name, args, context);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value });
});
