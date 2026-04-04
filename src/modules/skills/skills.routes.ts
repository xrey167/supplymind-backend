import { OpenAPIHono } from '@hono/zod-openapi';
import { skillsController } from './skills.controller';

export const SkillsRoutes = new OpenAPIHono();

SkillsRoutes.get('/', (c) => skillsController.list(c));
SkillsRoutes.get('/:name', (c) => skillsController.describe(c));
SkillsRoutes.post('/:name/invoke', (c) => skillsController.invoke(c));
