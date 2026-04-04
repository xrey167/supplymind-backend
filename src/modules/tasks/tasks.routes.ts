import { Hono } from 'hono';
import { tasksController } from './tasks.controller';

export const TasksRoutes = new Hono();

TasksRoutes.post('/', tasksController.sendTask);
TasksRoutes.get('/', tasksController.listTasks);
TasksRoutes.get('/:id', tasksController.getTask);
TasksRoutes.post('/:id/cancel', tasksController.cancelTask);
TasksRoutes.get('/:id/events', tasksController.streamTaskEvents);
