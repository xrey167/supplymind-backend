import { Hono } from 'hono';
import { sessionsController } from './sessions.controller';

export const sessionsRoutes = new Hono()
  .post('/', sessionsController.create)
  .get('/:id', sessionsController.get)
  .post('/:id/messages', sessionsController.addMessage)
  .get('/:id/messages', sessionsController.getMessages)
  .post('/:id/resume', sessionsController.resume)
  .post('/:id/close', sessionsController.close);
