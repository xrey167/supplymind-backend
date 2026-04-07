export type PluginKind = 'remote_mcp' | 'remote_a2a' | 'webhook' | 'local_sandboxed';

export type PluginStatus =
  | 'installing' | 'active' | 'disabled' | 'failed' | 'uninstalling' | 'uninstalled';

export type PluginEventType =
  | 'installed' | 'enabled' | 'disabled' | 'config_updated' | 'version_pinned'
  | 'health_checked' | 'uninstalled' | 'rollback_initiated' | 'rollback_completed';

export type PluginPermission =
  | 'workspace:read' | 'workspace:write'
  | 'credentials:bind' | 'agent:invoke' | 'hitl:request'
  | 'erp:read' | 'erp:write' | 'local_sandboxed:run';

export interface PluginCapability {
  id: string;
  config?: Record<string, unknown>;
}

export interface PluginManifestV1 {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description: string;
  author?: string;
  capabilities: PluginCapability[];
  requiredPermissions: PluginPermission[];
  configSchema?: Record<string, unknown>;
  hitlActions?: string[];
  healthCheckUrl?: string;
  onInstall?: (workspaceId: string, config: Record<string, unknown>) => Promise<void>;
  onUninstall?: (workspaceId: string) => Promise<void>;
}

export interface CatalogRow {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  capabilities: PluginCapability[];
  requiredPermissions: PluginPermission[];
  manifest: Record<string, unknown>;
  publisher: string | null;
  verified: boolean;
  createdAt: Date;
}

export interface InstallationRow {
  id: string;
  workspaceId: string;
  pluginId: string;
  status: PluginStatus;
  pinnedVersion: string | null;
  config: Record<string, unknown>;
  secretBindingIds: string[];
  policyBinding: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}

export interface PluginEventRow {
  id: string;
  installationId: string;
  workspaceId: string;
  eventType: PluginEventType;
  actorId: string;
  actorType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface HealthCheckRow {
  id: string;
  installationId: string;
  checkedAt: Date;
  status: 'healthy' | 'degraded' | 'unreachable';
  latencyMs: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface Actor {
  id: string;
  type: 'user' | 'api_key' | 'system';
}
