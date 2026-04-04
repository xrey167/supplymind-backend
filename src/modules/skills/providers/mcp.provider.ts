import { ok, err } from '../../../core/result';
import { mcpClientPool } from '../../../infra/mcp/client-pool';
import type { McpServerConfig } from '../../../infra/mcp/types';
import type { Skill, SkillProvider } from '../skills.types';

export class McpSkillProvider implements SkillProvider {
  type = 'mcp' as const;
  priority = 15;
  private configs: McpServerConfig[];

  constructor(configs: McpServerConfig[]) {
    this.configs = configs.filter((c) => c.enabled);
  }

  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const config of this.configs) {
      try {
        const manifest = await mcpClientPool.listTools(config);
        for (const tool of manifest.tools) {
          skills.push({
            id: `mcp_${manifest.serverName}_${tool.name}`,
            name: `${manifest.serverName}_${tool.name}`,
            description: `[MCP:${manifest.serverName}] ${tool.description}`,
            inputSchema: tool.inputSchema,
            providerType: 'mcp',
            priority: this.priority,
            handler: async (args) => {
              try {
                const result = await mcpClientPool.callTool(
                  config.id,
                  tool.name,
                  (args ?? {}) as Record<string, unknown>,
                );
                return ok(result);
              } catch (error) {
                return err(error instanceof Error ? error : new Error(String(error)));
              }
            },
          });
        }
      } catch (error) {
        console.warn(
          `[McpSkillProvider] Failed to load tools from MCP server "${config.name}" (${config.id}):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return skills;
  }
}
