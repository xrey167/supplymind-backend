export type PluginKind = 'remote_mcp' | 'remote_a2a' | 'webhook' | 'local_sandboxed';

export type PluginStatus =
  | 'installing' | 'active' | 'disabled' | 'failed' | 'uninstalling' | 'uninstalled';

export type PluginEventType =
  | 'installed' | 'enabled' | 'disabled' | 'config_updated' | 'version_pinned'
  | 'health_checked' | 'uninstalled' | 'rollback_initiated' | 'rollback_completed';

export type CorePluginPermission =
  | 'workspace:read' | 'workspace:write'
  | 'credentials:bind' | 'agent:invoke' | 'hitl:request'
  | 'local_sandboxed:run';

export type ErpPluginPermission = 'erp:read' | 'erp:write';

export type PluginPermission = CorePluginPermission | ErpPluginPermission;

export const VALID_TRANSITIONS: Record<PluginStatus, PluginStatus[]> = {
  installing:   ['active', 'failed'],
  active:       ['disabled', 'uninstalling', 'failed'],
  disabled:     ['active', 'uninstalling'],
  failed:       ['installing', 'uninstalling'],
  uninstalling: ['uninstalled', 'failed'],
  uninstalled:  [],
};

export class PluginConflictError extends Error {
  readonly code = 'PLUGIN_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'PluginConflictError';
  }
}

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
