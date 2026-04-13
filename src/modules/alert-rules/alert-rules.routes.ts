import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { alertRulesService } from './alert-rules.service';
import { CreateAlertRuleBodySchema, UpdateAlertRuleBodySchema, AlertRuleParamsSchema } from './alert-rules.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

export const alertRulesRoutes = new OpenAPIHono<AppEnv>();

alertRulesRoutes.openapi(
  createRoute({ method: 'get', path: '/', responses: { 200: { description: 'List alert rules', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const rules = await alertRulesService.listRules(workspaceId);
    return c.json({ data: rules });
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'post', path: '/', request: { body: { content: { 'application/json': { schema: CreateAlertRuleBodySchema } } } }, responses: { 201: { description: 'Rule created', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const callerId = c.get('callerId') as string;
    const body = c.req.valid('json');
    const rule = await alertRulesService.createRule({ workspaceId, createdBy: callerId, ...body });
    return c.json({ data: rule }, 201);
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'get', path: '/:ruleId', request: { params: AlertRuleParamsSchema }, responses: { 200: { description: 'Get rule', ...jsonRes } } }),
  async (c) => {
    const { ruleId } = c.req.valid('param');
    const rule = await alertRulesService.getRule(ruleId);
    return c.json({ data: rule });
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'put', path: '/:ruleId', request: { params: AlertRuleParamsSchema, body: { content: { 'application/json': { schema: UpdateAlertRuleBodySchema } } } }, responses: { 200: { description: 'Rule updated', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { ruleId } = c.req.valid('param');
    const body = c.req.valid('json');
    const rule = await alertRulesService.updateRule(ruleId, workspaceId, body);
    return c.json({ data: rule });
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'delete', path: '/:ruleId', request: { params: AlertRuleParamsSchema }, responses: { 204: { description: 'Rule deleted' } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { ruleId } = c.req.valid('param');
    await alertRulesService.deleteRule(ruleId, workspaceId);
    return new Response(null, { status: 204 });
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'patch', path: '/:ruleId/toggle', request: { params: AlertRuleParamsSchema }, responses: { 200: { description: 'Rule toggled', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { ruleId } = c.req.valid('param');
    const rule = await alertRulesService.toggleRule(ruleId, workspaceId);
    return c.json({ data: rule });
  },
);

alertRulesRoutes.openapi(
  createRoute({ method: 'get', path: '/:ruleId/history', request: { params: AlertRuleParamsSchema }, responses: { 200: { description: 'Fire history', ...jsonRes } } }),
  async (c) => {
    const workspaceId = c.get('workspaceId');
    const { ruleId } = c.req.valid('param');
    const fires = await alertRulesService.listFires(ruleId, workspaceId);
    return c.json({ data: fires });
  },
);
