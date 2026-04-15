import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { commandsService } from './commands.service';
import { listCommandsQuerySchema, commandDtoSchema } from './commands.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Commands'],
  summary: 'List available commands',
  description: 'Returns all commands available in this workspace — global plugin-contributed commands and workspace-scoped skills.',
  request: { query: listCommandsQuerySchema },
  responses: {
    200: {
      description: 'List of commands',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(commandDtoSchema) }),
        },
      },
    },
  },
});

export const CommandsRoutes = new OpenAPIHono<AppEnv>();

CommandsRoutes.openapi(listRoute, (c) => {
  const { source } = c.req.valid('query');
  const data = commandsService.list(source ? { source } : undefined);
  return c.json({ data }, 200);
});
