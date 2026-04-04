import { Hono } from 'hono';
import { orchestrationController } from './orchestration.controller';

export const orchestrationRoutes = new Hono()
  .post('/', orchestrationController.create)
  .post('/:id/run', orchestrationController.run)
  .get('/:id', orchestrationController.get);
