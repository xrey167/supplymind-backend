import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { skillRegistry } from '../../modules/skills/skills.registry';

export function createMcpServer() {
  const server = new Server(
    { name: 'supplymind-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skills = skillRegistry.list();
    return {
      tools: skills.map((s) => ({
        name: s.name,
        description: s.description,
        inputSchema: {
          type: 'object' as const,
          ...s.inputSchema,
        },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await skillRegistry.invoke(name, args ?? {});

    if (!result.ok) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
        isError: true,
      };
    }

    const text = typeof result.value === 'string'
      ? result.value
      : JSON.stringify(result.value, null, 2);

    return {
      content: [{ type: 'text' as const, text }],
    };
  });

  return server;
}
