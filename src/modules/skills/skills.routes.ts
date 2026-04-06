import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { skillsService } from './skills.service';
import { invokeSkillBodySchema, skillNameParamSchema, skillMcpConfigSchema } from './skills.schemas';
import { Roles } from '../../core/security';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const skillIdParamSchema = z.object({ skillId: z.string().min(1) });

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

const getMcpConfigRoute = createRoute({
  method: 'get', path: '/{skillId}/mcp',
  request: { params: skillIdParamSchema },
  responses: { 200: { description: 'Skill MCP config', ...jsonRes }, 404: { description: 'Skill not found', ...jsonRes } },
});

const setMcpConfigRoute = createRoute({
  method: 'put', path: '/{skillId}/mcp',
  request: {
    params: skillIdParamSchema,
    body: { content: { 'application/json': { schema: skillMcpConfigSchema } } },
  },
  responses: { 200: { description: 'MCP config updated', ...jsonRes }, 400: { description: 'Bad request', ...jsonRes }, 404: { description: 'Skill not found', ...jsonRes } },
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

SkillsRoutes.openapi(getMcpConfigRoute, async (c) => {
  const { skillId } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') ?? 'default';
  const result = await skillsService.getMcpConfig(workspaceId, skillId);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ mcpConfig: result.value });
});

SkillsRoutes.openapi(setMcpConfigRoute, async (c) => {
  const { skillId } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') ?? 'default';
  const config = c.req.valid('json');
  const result = await skillsService.setMcpConfig(workspaceId, skillId, config);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ ok: true });
});
