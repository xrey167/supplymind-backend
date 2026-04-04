import type { Context } from 'hono';
import { skillsService } from './skills.service';
import { listSkillsQuerySchema, invokeSkillBodySchema, skillNameParamSchema } from './skills.schemas';

export const skillsController = {
  async list(c: Context) {
    const skills = skillsService.listSkills();
    return c.json({ data: skills.map(({ handler, ...rest }) => rest) });
  },

  async describe(c: Context) {
    const { name } = skillNameParamSchema.parse(c.req.param());
    const skill = skillsService.describeSkill(name);
    if (!skill) return c.json({ error: `Skill not found: ${name}` }, 404);
    const { handler, ...rest } = skill;
    return c.json({ data: rest });
  },

  async invoke(c: Context) {
    const { name } = skillNameParamSchema.parse(c.req.param());
    const { args } = invokeSkillBodySchema.parse(await c.req.json());
    const context = {
      callerId: 'anonymous',
      workspaceId: 'default',
      callerRole: 'user',
    };
    const result = await skillsService.invokeSkill(name, args, context);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value });
  },
};
