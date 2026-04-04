import { workspaceSettingsRepo } from './workspace-settings.repo';
import {
  WorkspaceSettingKeys,
  toolPermissionModeSchema,
  allowedToolNamesSchema,
  sandboxPolicySchema,
  mcpServerPolicySchema,
} from './workspace-settings.schemas';
import type { ToolPermissionMode, SandboxPolicy, McpServerPolicy, WorkspaceSettingKey, UpdateWorkspaceSettingsInput } from './workspace-settings.schemas';

export class WorkspaceSettingsService {
  async getRaw(workspaceId: string, key: WorkspaceSettingKey): Promise<unknown | null> {
    const row = await workspaceSettingsRepo.get(workspaceId, key);
    return row?.value ?? null;
  }

  async set(workspaceId: string, key: WorkspaceSettingKey, value: unknown): Promise<void> {
    await workspaceSettingsRepo.set(workspaceId, key, value);
  }

  async delete(workspaceId: string, key: WorkspaceSettingKey): Promise<boolean> {
    return workspaceSettingsRepo.delete(workspaceId, key);
  }

  async getAll(workspaceId: string): Promise<Record<string, unknown>> {
    const rows = await workspaceSettingsRepo.getAll(workspaceId);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // --- Typed getters with validation and defaults ---

  async getToolPermissionMode(workspaceId: string): Promise<ToolPermissionMode> {
    const raw = await this.getRaw(workspaceId, WorkspaceSettingKeys.TOOL_PERMISSION_MODE);
    return toolPermissionModeSchema.parse(raw ?? 'auto');
  }

  async getAllowedToolNames(workspaceId: string): Promise<string[]> {
    const raw = await this.getRaw(workspaceId, WorkspaceSettingKeys.ALLOWED_TOOL_NAMES);
    return allowedToolNamesSchema.parse(raw ?? []);
  }

  /**
   * Returns a flat view of the tool-permission settings used by the API.
   */
  async getToolSettings(workspaceId: string): Promise<{ toolPermissionMode: ToolPermissionMode; allowedToolNames: string[] }> {
    const [toolPermissionMode, allowedToolNames] = await Promise.all([
      this.getToolPermissionMode(workspaceId),
      this.getAllowedToolNames(workspaceId),
    ]);
    return { toolPermissionMode, allowedToolNames };
  }

  /**
   * Applies a partial patch to the tool-permission settings.
   */
  async updateToolSettings(workspaceId: string, input: UpdateWorkspaceSettingsInput): Promise<{ toolPermissionMode: ToolPermissionMode; allowedToolNames: string[] }> {
    const ops: Promise<unknown>[] = [];
    if (input.toolPermissionMode !== undefined) {
      ops.push(this.set(workspaceId, WorkspaceSettingKeys.TOOL_PERMISSION_MODE, input.toolPermissionMode));
    }
    if (input.allowedToolNames !== undefined) {
      ops.push(this.set(workspaceId, WorkspaceSettingKeys.ALLOWED_TOOL_NAMES, input.allowedToolNames));
    }
    await Promise.all(ops);
    return this.getToolSettings(workspaceId);
  }

  async getSandboxPolicy(workspaceId: string): Promise<SandboxPolicy> {
    const raw = await this.getRaw(workspaceId, WorkspaceSettingKeys.SANDBOX_POLICY);
    return sandboxPolicySchema.parse(raw ?? {});
  }

  async getMcpServerPolicy(workspaceId: string): Promise<McpServerPolicy> {
    const raw = await this.getRaw(workspaceId, WorkspaceSettingKeys.MCP_SERVER_POLICY);
    return mcpServerPolicySchema.parse(raw ?? {});
  }

  // Spec-contract aliases
  getSettings = this.getToolSettings;
  updateSettings = this.updateToolSettings;
  getMode = this.getToolPermissionMode;
}

export const workspaceSettingsService = new WorkspaceSettingsService();
