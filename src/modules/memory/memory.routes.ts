import { Hono } from 'hono';
import { memoryController } from './memory.controller';

export const memoryRoutes = new Hono()
  .post('/', memoryController.save)
  .post('/recall', memoryController.recall)
  .get('/', memoryController.list)
  .delete('/:id', memoryController.forget)
  .post('/proposals', memoryController.propose)
  .post('/proposals/:id/approve', memoryController.approveProposal)
  .post('/proposals/:id/reject', memoryController.rejectProposal);
