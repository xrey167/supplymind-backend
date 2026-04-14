import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { pluginCatalogRepo } from './plugins.catalog.repo';
import { pluginInstallationRepo } from './plugins.installation.repo';
import { pluginHealthRepo } from './plugins.health.repo';
import { validatePluginConfig, checkPermissions } from './plugins.manifest-validator';
import { featureFlagsService } from '../feature-flags/feature-flags.service';
import { credentialsService } from '../credentials/credentials.service';
import type { InstallationRow, PluginEventRow, HealthCheckRow, Actor, PluginManifestV1 } from './plugins.types';
import { PluginConflictError } from './plugins.types';

const DEFAULT_CALLER_PERMISSIONS = ['workspace:read'];

const BLOCKED_HOSTNAMES = [
  /^localhost$/,
  /^127\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^(fc|fd)/i,    // IPv6 ULA private ranges
  /^fe80/i,       // IPv6 link-local
  /^::ffff:/i,    // IPv4-mapped IPv6
];

function isAllowedHealthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.some(r => r.test(hostname))) return false;
    return true;
  } catch (e) {
    if (e instanceof TypeError) return false;
    throw e;
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
    if (existing && existing.status !== 'uninstalled') {
      if (existing.status === 'active') return err(new Error('Plugin already installed and active'));
      if (existing.status === 'installing') return err(new Error('Plugin installation is already in progress'));
      return err(new Error(`Plugin exists with status '${existing.status}' — uninstall it first or re-enable it`));
    }

    // For erp-bc: strip clientSecret from stored config; it will be stored encrypted
    let storedConfig = config;
    let erpBcClientSecret: string | undefined;
    if (manifest.id === 'erp-bc' && (config as any).clientSecret) {
      const { clientSecret: _, ...safeConfig } = config as any;
      erpBcClientSecret = _ as string;
      storedConfig = safeConfig;
    }

    let installation: InstallationRow;
    try {
      installation = await pluginInstallationRepo.create({ workspaceId, pluginId, config: storedConfig });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return err(new Error('Plugin already being installed for this workspace'));
      }
      throw e;
    }

    let active: InstallationRow;
    try {
      const result = await pluginInstallationRepo.transition(
        installation.id, workspaceId, 'active', 'installed', actor,
        { pluginId, config: storedConfig },
      );
      active = result.installation;
    } catch (e) {
      logger.error({ err: e, installationId: installation.id, workspaceId, pluginId }, 'Plugin install transition failed — orphaned installation row may remain');
      return err(new Error('Plugin install failed during activation'));
    }

    // For erp-bc: store clientSecret encrypted and bind to installation
    if (erpBcClientSecret) {
      const credResult = await credentialsService.create({
        workspaceId,
        name: 'erp-bc-client-secret',
        provider: 'erp-bc',
        value: erpBcClientSecret,
        metadata: { installationId: active.id },
      });
      if (credResult.ok) {
        await pluginInstallationRepo.updateSecretBindingIds(active.id, [credResult.value.id]);
        active = { ...active, secretBindingIds: [credResult.value.id] };
      } else {
        logger.error({ err: credResult.error, installationId: active.id, workspaceId }, 'Failed to store erp-bc client secret — installation active but secret not encrypted');
      }
    }

    return ok(active);
  },

  async enable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'disabled') return err(new Error(`Cannot enable plugin in status: ${inst.status}`));

    try {
      const { installation } = await pluginInstallationRepo.transition(
        installationId, workspaceId, 'active', 'enabled', actor,
      );
      return ok(installation);
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Plugin enable transition failed');
      return err(new Error('Internal error enabling plugin'));
    }
  },

  async disable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot disable plugin in status: ${inst.status}`));

    try {
      const { installation } = await pluginInstallationRepo.transition(
        installationId, workspaceId, 'disabled', 'disabled', actor,
      );
      return ok(installation);
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Plugin disable transition failed');
      return err(new Error('Internal error disabling plugin'));
    }
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

    // For erp-bc: strip clientSecret from stored config and update encrypted credential
    let storedConfig = config;
    let erpBcClientSecret: string | undefined;
    if (manifest.id === 'erp-bc' && (config as any).clientSecret) {
      const { clientSecret: _, ...safeConfig } = config as any;
      erpBcClientSecret = _ as string;
      storedConfig = safeConfig;
    }

    let updatedInstallation: InstallationRow;
    try {
      const result = await pluginInstallationRepo.transition(
        installationId, workspaceId, 'active', 'config_updated', actor,
        { previousConfig: inst.config, newConfig: storedConfig },
        { config: storedConfig },
      );
      updatedInstallation = result.installation;
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Plugin updateConfig transition failed');
      return err(new Error('Internal error updating plugin config'));
    }

    // For erp-bc: update or create encrypted credential for clientSecret
    if (erpBcClientSecret) {
      const existingSecretId = (inst.secretBindingIds as string[] | undefined)?.[0];
      if (existingSecretId) {
        const updateResult = await credentialsService.update(existingSecretId, { value: erpBcClientSecret });
        if (!updateResult.ok) {
          logger.error({ err: updateResult.error, credentialId: existingSecretId, installationId, workspaceId }, 'Failed to update erp-bc client secret credential');
        }
      } else {
        const credResult = await credentialsService.create({
          workspaceId,
          name: 'erp-bc-client-secret',
          provider: 'erp-bc',
          value: erpBcClientSecret,
          metadata: { installationId },
        });
        if (credResult.ok) {
          await pluginInstallationRepo.updateSecretBindingIds(installationId, [credResult.value.id]);
          updatedInstallation = { ...updatedInstallation, secretBindingIds: [credResult.value.id] };
        } else {
          logger.error({ err: credResult.error, installationId, workspaceId }, 'Failed to create erp-bc client secret credential during updateConfig');
        }
      }
    }

    return ok(updatedInstallation);
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

    try {
      const { installation } = await pluginInstallationRepo.transition(
        installationId, workspaceId, 'active', 'version_pinned', actor,
        { version, config: inst.config },
        { pinnedVersion: version },
      );
      return ok(installation);
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Plugin pinVersion transition failed');
      return err(new Error('Internal error pinning plugin version'));
    }
  },

  async uninstall(workspaceId: string, installationId: string, actor: Actor): Promise<Result<void>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active' && inst.status !== 'disabled') {
      return err(new Error(`Cannot uninstall plugin in status: ${inst.status}`));
    }

    try {
      await pluginInstallationRepo.transition(installationId, workspaceId, 'uninstalling', 'uninstalled', actor);
      await pluginInstallationRepo.transition(installationId, workspaceId, 'uninstalled', 'uninstalled', actor);
      return ok(undefined);
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Plugin uninstall transition failed');
      return err(new Error('Internal error uninstalling plugin'));
    }
  },

  async rollback(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'failed' && inst.status !== 'disabled') {
      return err(new Error(`Cannot rollback plugin in status: ${inst.status}`));
    }

    const lastPin = await pluginInstallationRepo.getLastVersionPinnedEvent(installationId);
    if (!lastPin) {
      return err(new PluginConflictError('No pinned version found to rollback to'));
    }

    const restoredConfig = typeof lastPin.payload.config === 'object' && lastPin.payload.config !== null
      ? lastPin.payload.config as Record<string, unknown>
      : inst.config;
    const restoredVersion = lastPin.payload.version != null
      ? String(lastPin.payload.version)
      : inst.pinnedVersion ?? undefined;

    try {
      await pluginInstallationRepo.transition(
        installationId, workspaceId, 'active', 'rollback_initiated', actor,
        { restoringTo: lastPin.payload },
      );
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Rollback initiation failed');
      return err(new Error('Failed to initiate rollback'));
    }

    try {
      const { installation } = await pluginInstallationRepo.transition(
        installationId, workspaceId, 'active', 'rollback_completed', actor,
        { restoredVersion: lastPin.payload },
        { config: restoredConfig, pinnedVersion: restoredVersion },
      );
      return ok(installation);
    } catch (e) {
      logger.error({ err: e, installationId, workspaceId }, 'Rollback completion failed — installation may be in inconsistent state');
      return err(new Error('Rollback initiated but failed to apply restored config'));
    }
  },

  async runHealthCheck(workspaceId: string, installationId: string): Promise<Result<HealthCheckRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst) return err(new Error('Installation not found'));
    if (inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));

    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    if (!catalog) return err(new Error('Plugin catalog entry not found'));

    const manifest = catalog.manifest as unknown as PluginManifestV1;
    const healthUrl = manifest.healthCheckUrl;

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
      error = 'Health check URL blocked by security policy';
    } else {
      status = inst.status === 'active' ? 'healthy' : 'degraded';
    }

    let row: HealthCheckRow;
    try {
      row = await pluginHealthRepo.create({ installationId, status, latencyMs, error });
    } catch (e) {
      logger.error({ err: e, installationId, status }, 'Failed to persist health check result');
      return err(new Error('Failed to persist health check result'));
    }

    try {
      await pluginInstallationRepo.transition(
        installationId, inst.workspaceId, inst.status, 'health_checked',
        { id: 'system', type: 'system' },
        { status, latencyMs, error },
      );
    } catch (e) {
      logger.error({ err: e, installationId }, 'Health check recorded but status update failed');
    }

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
