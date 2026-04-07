import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { pluginCatalogRepo } from './plugins.catalog.repo';
import { pluginInstallationRepo } from './plugins.installation.repo';
import { pluginHealthRepo } from './plugins.health.repo';
import { validatePluginConfig, checkPermissions } from './plugins.manifest-validator';
import { featureFlagsService } from '../feature-flags/feature-flags.service';
import type { InstallationRow, PluginEventRow, HealthCheckRow, Actor, PluginManifestV1 } from './plugins.types';

const DEFAULT_CALLER_PERMISSIONS = ['workspace:read'];

function isAllowedHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    if (/^10\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;
    if (/^169\.254\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export const pluginsService = {
  async install(
    workspaceId: string,
    pluginId: string,
    config: Record<string, unknown>,
    actor: Actor,
    callerPermissions: string[] = [],
  ): Promise<Result<InstallationRow>> {
    const platformEnabled = await featureFlagsService.isEnabled(workspaceId, 'plugins.platform.enabled');
    if (!platformEnabled) return err(new Error('Plugin platform not enabled for this workspace'));

    const catalog = await pluginCatalogRepo.findById(pluginId);
    if (!catalog) return err(new Error(`Plugin not found: ${pluginId}`));

    if (catalog.kind === 'local_sandboxed') {
      const sandboxEnabled = await featureFlagsService.isEnabled(workspaceId, 'plugins.local_sandboxed.enabled');
      if (!sandboxEnabled) {
        return err(new Error('local_sandboxed plugins are not enabled for this workspace'));
      }
    }

    const allCallerPerms = [...DEFAULT_CALLER_PERMISSIONS, ...callerPermissions];
    const permCheck = checkPermissions(allCallerPerms, catalog.requiredPermissions as string[]);
    if (!permCheck.allowed) {
      return err(new Error(`Missing permissions: ${permCheck.missing.join(', ')}`));
    }

    const manifest = catalog.manifest as unknown as PluginManifestV1;
    const configCheck = validatePluginConfig(config, manifest.configSchema);
    if (!configCheck.valid) return err(new Error(configCheck.error));

    const existing = await pluginInstallationRepo.findByWorkspaceAndPlugin(workspaceId, pluginId);
    if (existing && existing.status === 'active') {
      return err(new Error('Plugin already installed and active'));
    }

    let installation: InstallationRow;
    try {
      installation = await pluginInstallationRepo.create({ workspaceId, pluginId, config });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return err(new Error('Plugin already being installed for this workspace'));
      }
      throw e;
    }

    const { installation: active } = await pluginInstallationRepo.transition(
      installation.id, workspaceId, 'active', 'installed', actor,
      { pluginId, config },
    );
    return ok(active);
  },

  async enable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'disabled') return err(new Error(`Cannot enable plugin in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'enabled', actor,
    );
    return ok(installation);
  },

  async disable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot disable plugin in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'disabled', 'disabled', actor,
    );
    return ok(installation);
  },

  async updateConfig(
    workspaceId: string,
    installationId: string,
    config: Record<string, unknown>,
    actor: Actor,
  ): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot update config in status: ${inst.status}`));

    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    if (!catalog) return err(new Error('Plugin catalog entry not found'));
    const manifest = catalog.manifest as unknown as PluginManifestV1;
    const configCheck = validatePluginConfig(config, manifest.configSchema);
    if (!configCheck.valid) return err(new Error(configCheck.error));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'config_updated', actor,
      { previousConfig: inst.config, newConfig: config },
      { config },
    );
    return ok(installation);
  },

  async pinVersion(
    workspaceId: string,
    installationId: string,
    version: string,
    actor: Actor,
  ): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot pin version in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'version_pinned', actor,
      { version, config: inst.config },
      { pinnedVersion: version },
    );
    return ok(installation);
  },

  async uninstall(workspaceId: string, installationId: string, actor: Actor): Promise<Result<void>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active' && inst.status !== 'disabled') {
      return err(new Error(`Cannot uninstall plugin in status: ${inst.status}`));
    }

    await pluginInstallationRepo.transition(installationId, workspaceId, 'uninstalled', 'uninstalled', actor);
    return ok(undefined);
  },

  async rollback(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'failed' && inst.status !== 'disabled') {
      return err(new Error(`Cannot rollback plugin in status: ${inst.status}`));
    }

    const lastPin = await pluginInstallationRepo.getLastVersionPinnedEvent(installationId);
    if (!lastPin) {
      return err(new Error('No pinned version found to rollback to — rollback not possible (409)'));
    }

    const restoredConfig = typeof lastPin.payload.config === 'object' && lastPin.payload.config !== null
      ? lastPin.payload.config as Record<string, unknown>
      : inst.config;
    const restoredVersion = lastPin.payload.version !== undefined && lastPin.payload.version !== null
      ? String(lastPin.payload.version)
      : inst.pinnedVersion ?? undefined;

    await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'rollback_initiated', actor,
      { restoringTo: lastPin.payload },
    );

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'rollback_completed', actor,
      { restoredVersion: lastPin.payload },
      {
        config: restoredConfig,
        pinnedVersion: restoredVersion,
      },
    );
    return ok(installation);
  },

  async runHealthCheck(
    workspaceIdOrInstallationId: string,
    installationId?: string,
  ): Promise<Result<HealthCheckRow>> {
    // Support both signatures: runHealthCheck(wsId, instId) and runHealthCheck(instId)
    let resolvedInstId: string;
    let resolvedWsId: string | undefined;
    if (installationId) {
      resolvedWsId = workspaceIdOrInstallationId;
      resolvedInstId = installationId;
    } else {
      resolvedInstId = workspaceIdOrInstallationId;
      resolvedWsId = undefined;
    }

    const inst = await pluginInstallationRepo.findById(resolvedInstId);
    if (!inst) return err(new Error('Installation not found'));
    if (resolvedWsId && inst.workspaceId !== resolvedWsId) return err(new Error('Installation not found'));

    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    const manifest = catalog?.manifest as unknown as PluginManifestV1 | undefined;
    const healthUrl = manifest?.healthCheckUrl;

    let status: 'healthy' | 'degraded' | 'unreachable' = 'unreachable';
    let latencyMs: number | undefined;
    let error: string | undefined;

    if (healthUrl && isAllowedHealthUrl(healthUrl)) {
      const start = performance.now();
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        latencyMs = Math.round(performance.now() - start);
        const body = await res.json() as { status?: string };
        status = body.status === 'ok' ? 'healthy' : 'degraded';
      } catch (fetchErr) {
        latencyMs = Math.round(performance.now() - start);
        error = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        status = 'unreachable';
      }
    } else if (healthUrl) {
      status = 'unreachable';
      error = 'Health check URL blocked by security policy';
    } else {
      status = inst.status === 'active' ? 'healthy' : 'degraded';
    }

    const row = await pluginHealthRepo.create({ installationId: resolvedInstId, status, latencyMs, error });

    await pluginInstallationRepo.transition(
      resolvedInstId, inst.workspaceId, inst.status, 'health_checked',
      { id: 'system', type: 'system' },
      { status, latencyMs, error },
    );

    return ok(row);
  },

  async list(workspaceId: string): Promise<InstallationRow[]> {
    return pluginInstallationRepo.findByWorkspace(workspaceId);
  },

  async get(workspaceId: string, installationId: string): Promise<InstallationRow | undefined> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return undefined;
    return inst;
  },

  async getEvents(workspaceId: string, installationId: string): Promise<Result<PluginEventRow[]>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    const events = await pluginInstallationRepo.getEvents(installationId);
    return ok(events);
  },
};
