/**
 * Plugin manifest system — declarative plugin definition.
 *
 * Customers define plugins as manifest objects that bundle skills, hooks,
 * and configuration into a single installable unit.
 *
 * Plug-and-play: install a plugin → its skills and hooks register automatically.
 * Multi-tenant: each workspace installs plugins independently.
 */

import type { HookEvent, HookHandler } from '../../core/hooks/hook-registry';
import type { ConfigScope } from '../../core/config/scoped-config';
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Domain schema types — declarative business context for AI adaptation
// ---------------------------------------------------------------------------

export interface DomainEntity {
  name: string;
  aliases?: string[];
  description: string;
}

export interface DomainRule {
  id: string;
  description: string;
  severity: 'info' | 'warn' | 'block';
}

export interface VocabularyTerm {
  term: string;
  definition: string;
  category?: string;
}

/**
 * Declarative domain schema that a plugin can ship with its manifest.
 * Seeds the domain knowledge graph on install and is continuously refined
 * by the learning engine via live observation.
 */
export interface DomainSchema {
  entities: DomainEntity[];
  vocabulary: VocabularyTerm[];
  rules: DomainRule[];
  /** Words that should raise risk classification (→ POWERFUL tier routing). */
  riskTerms?: string[];
  /** Key verbs that enrich intent classification (→ BALANCED tier routing). */
  primaryActions?: string[];
}

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface PluginSkillDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  concurrencySafe?: boolean;
  timeoutMs?: number;
}

export interface PluginHookDefinition {
  event: HookEvent | HookEvent[];
  handler: HookHandler;
}

export interface PluginConfigDefinition {
  key: string;
  description: string;
  defaultValue: unknown;
  scope?: ConfigScope;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  skills?: PluginSkillDefinition[];
  hooks?: PluginHookDefinition[];
  config?: PluginConfigDefinition[];
  /**
   * Optional domain schema. When present, seeds the domain knowledge graph on
   * install so the AI platform becomes domain-aware for this plugin.
   */
  domain?: DomainSchema;
  /** Called once when the plugin is installed for a workspace. */
  onInstall?: (workspaceId: string) => Promise<void>;
  /** Called when the plugin is uninstalled. */
  onUninstall?: (workspaceId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin manager
// ---------------------------------------------------------------------------

interface InstalledPlugin {
  manifest: PluginManifest;
  workspaceId: string;
  installedAt: number;
  cleanups: Array<() => void>;
}

export class PluginManager {
  private installed = new Map<string, InstalledPlugin>();

  /**
   * Install a plugin for a workspace.
   * Registers all skills, hooks, and config from the manifest.
   * Returns a cleanup function to uninstall.
   */
  async install(manifest: PluginManifest, workspaceId: string): Promise<() => Promise<void>> {
    const key = `${workspaceId}:${manifest.id}`;
    if (this.installed.has(key)) {
      throw new Error(`Plugin '${manifest.id}' already installed for workspace '${workspaceId}'`);
    }

    const cleanups: Array<() => void> = [];

    // Register skills
    if (manifest.skills?.length) {
      const { skillRegistry } = await import('../skills/skills.registry');
      const { ok } = await import('../../core/result');
      for (const skillDef of manifest.skills) {
        const skillId = `plugin:${manifest.id}:${skillDef.name}`;
        skillRegistry.register({
          id: skillId,
          name: skillDef.name,
          description: skillDef.description,
          inputSchema: skillDef.inputSchema ?? { type: 'object', properties: {} },
          providerType: 'plugin',
          priority: 3,
          handler: async (args) => {
            const result = await skillDef.handler(args);
            return ok(result);
          },
        });
        cleanups.push(() => skillRegistry.unregister(skillDef.name));
      }
    }

    // Register hooks
    if (manifest.hooks?.length) {
      const { lifecycleHooks } = await import('../../core/hooks/hook-registry');
      for (const hookDef of manifest.hooks) {
        const hookId = `plugin:${manifest.id}:${crypto.randomUUID()}`;
        lifecycleHooks.register(workspaceId, {
          id: hookId,
          event: hookDef.event,
          handler: hookDef.handler,
          provider: `plugin:${manifest.id}`,
        });
        cleanups.push(() => lifecycleHooks.unregister(hookId, workspaceId));
      }
    }

    // Set default config values
    if (manifest.config?.length) {
      const { scopedConfig } = await import('../../core/config/scoped-config');
      for (const cfg of manifest.config) {
        const scope = cfg.scope ?? 'workspace';
        scopedConfig.set(scope, workspaceId, `plugin:${manifest.id}:${cfg.key}`, cfg.defaultValue, `plugin:${manifest.id}`);
        cleanups.push(() => scopedConfig.delete(scope, workspaceId, `plugin:${manifest.id}:${cfg.key}`));
      }
    }

    // Seed domain knowledge if the manifest declares a domain schema
    if (manifest.domain) {
      const { domainKnowledgeService } = await import('../domain-knowledge/domain-knowledge.service');
      await domainKnowledgeService.seed(manifest.id, workspaceId, manifest.domain);
      cleanups.push(async () => {
        const { domainKnowledgeService: svc } = await import('../domain-knowledge/domain-knowledge.service');
        await svc.remove(manifest.id, workspaceId).catch(() => { /* swallow */ });
      });
    }

    // Create adaptation agent for this plugin
    try {
      const { db } = await import('../../infra/db/client');
      const { adaptationAgents } = await import('../../infra/db/schema');
      await db.insert(adaptationAgents).values({
        workspaceId,
        pluginId: manifest.id,
        status: 'active',
        config: {},
      }).onConflictDoUpdate({
        target: [adaptationAgents.workspaceId, adaptationAgents.pluginId],
        set: { status: 'active' },
      });
      const { enqueueAdaptationAgent } = await import('../../jobs/learning/adaptation-agent.job');
      await enqueueAdaptationAgent(workspaceId, manifest.id);
      cleanups.push(async () => {
        const { db: _db } = await import('../../infra/db/client');
        const { adaptationAgents: _aa } = await import('../../infra/db/schema');
        const { eq, and } = await import('drizzle-orm');
        await _db.update(_aa).set({ status: 'deactivated' }).where(
          and(eq(_aa.workspaceId, workspaceId), eq(_aa.pluginId, manifest.id)),
        ).catch(() => { /* swallow */ });
        const { removeAdaptationAgent } = await import('../../jobs/learning/adaptation-agent.job');
        await removeAdaptationAgent(workspaceId, manifest.id).catch(() => { /* swallow */ });
      });
    } catch (e) {
      // Adaptation agent setup is best-effort — don't fail the install
      logger.warn({ pluginId: manifest.id, workspaceId, error: e }, 'Adaptation agent setup failed (non-fatal)');
    }

    // Run onInstall
    if (manifest.onInstall) {
      await manifest.onInstall(workspaceId);
    }

    this.installed.set(key, {
      manifest,
      workspaceId,
      installedAt: Date.now(),
      cleanups,
    });

    logger.info({ pluginId: manifest.id, workspaceId, skills: manifest.skills?.length ?? 0, hooks: manifest.hooks?.length ?? 0 }, 'Plugin installed');

    return () => this.uninstall(manifest.id, workspaceId);
  }

  async uninstall(pluginId: string, workspaceId: string): Promise<void> {
    const key = `${workspaceId}:${pluginId}`;
    const entry = this.installed.get(key);
    if (!entry) return;

    // Run cleanups in reverse order
    for (let i = entry.cleanups.length - 1; i >= 0; i--) {
      try { entry.cleanups[i](); } catch { /* swallow */ }
    }

    if (entry.manifest.onUninstall) {
      await entry.manifest.onUninstall(workspaceId).catch((e) => {
        logger.error({ pluginId, workspaceId, error: e }, 'Plugin onUninstall threw');
      });
    }

    this.installed.delete(key);
    logger.info({ pluginId, workspaceId }, 'Plugin uninstalled');
  }

  /** List installed plugins for a workspace. */
  list(workspaceId: string): Array<{ id: string; name: string; version: string; installedAt: number }> {
    const result: Array<{ id: string; name: string; version: string; installedAt: number }> = [];
    for (const [key, entry] of this.installed) {
      if (entry.workspaceId === workspaceId) {
        result.push({
          id: entry.manifest.id,
          name: entry.manifest.name,
          version: entry.manifest.version,
          installedAt: entry.installedAt,
        });
      }
    }
    return result;
  }

  isInstalled(pluginId: string, workspaceId: string): boolean {
    return this.installed.has(`${workspaceId}:${pluginId}`);
  }

  /** Clear everything (tests). */
  clear(): void {
    this.installed.clear();
  }
}

export const pluginManager = new PluginManager();
