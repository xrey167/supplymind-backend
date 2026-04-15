/**
 * Plugin Contribution Registry
 *
 * Plugins declare what they contribute to the platform at startup via a
 * `contributions` block in their PluginManifest. Contributions are global —
 * they register once at app boot and serve all workspaces. The registry
 * collects and exposes these contributions so bootstrap can apply them.
 *
 * Supported contribution types:
 *   - topics: event topic constants merged into the global Topics object
 *   - roles: workspace role → RBAC privilege mappings + tool-prefix allowlists
 *   - workers: BullMQ worker factories started once per app process
 *   - permissionLayers: PermissionPipeline layers injected at startup
 *   - commands: global slash commands registered into the skill registry at startup
 *   - hooks: global lifecycle hooks registered into lifecycleHooks at startup
 *   - promptTemplates: prompt templates seeded into a workspace on plugin install
 */

import type { PermissionLayer } from '../../core/permissions/types';
import type { Role } from '../../core/security/rbac';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { HookEvent, HookHandler } from '../../core/hooks/hook-registry';

// ---------------------------------------------------------------------------
// Contribution types
// ---------------------------------------------------------------------------

/** Map of topic constant key → dot-separated topic name. */
export interface PluginTopicContributions {
  [key: string]: string;
}

/** A workspace role contributed by a plugin with its RBAC privilege level. */
export interface WorkspaceRoleContribution {
  /** The workspace role string, e.g. 'procurement_manager'. */
  role: string;
  /** Privilege level this role maps to in the core RBAC hierarchy. */
  privilege: Role;
  /** Tool name prefixes this role is allowed to invoke. */
  allowedToolPrefixes: string[];
}

/** A BullMQ worker that a plugin starts at app boot. */
export interface WorkerContribution {
  /** Human-readable name for logging, e.g. 'erp-bc:sync'. */
  name: string;
  /** BullMQ queue name this worker processes, e.g. 'erp-sync'. */
  queueName: string;
  /** Factory called once at startup with the shared Redis connection. */
  factory: (connection: Redis) => Worker;
}

/** A global slash command contributed by a plugin — registered at app startup. */
export interface CommandContribution {
  /** Slash command name, e.g. 'erp-bc:status'. Invoked as /erp-bc:status in chat. */
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  concurrencySafe?: boolean;
  timeoutMs?: number;
}

/** A global lifecycle hook contributed by a plugin — registered at app startup for all workspaces. */
export interface HookContribution {
  /** Human-readable name used as the hook registration ID suffix. */
  name: string;
  event: HookEvent | HookEvent[];
  handler: HookHandler;
}

/** A prompt template seeded into a workspace when the plugin is installed. */
export interface PromptTemplateContribution {
  /** Name must be unique within a plugin. Stored as `{pluginId}/{name}` in the workspace. */
  name: string;
  description?: string;
  /** Content with optional {{variable}} placeholders — variables are auto-extracted. */
  content: string;
  tags?: string[];
}

/** All contribution types a plugin manifest can declare. */
export interface PluginContributions {
  topics?: PluginTopicContributions;
  roles?: WorkspaceRoleContribution[];
  workers?: WorkerContribution[];
  permissionLayers?: PermissionLayer[];
  /** Global slash commands registered at startup, available in all workspaces without installation. */
  commands?: CommandContribution[];
  /** Global lifecycle hooks registered at startup, fired for all workspaces. */
  hooks?: HookContribution[];
  /** Prompt templates seeded into a workspace when the plugin is installed there. */
  promptTemplates?: PromptTemplateContribution[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginContributionRegistry {
  private contributions = new Map<string, PluginContributions>();
  private activeWorkers: Array<{ worker: Worker; name: string }> = [];

  /**
   * Register a plugin's contributions by plugin ID.
   * Calling register() twice for the same ID overwrites the previous entry.
   */
  register(pluginId: string, contributions: PluginContributions): void {
    this.contributions.set(pluginId, contributions);
  }

  /** Merged topic map from all registered plugins. */
  getTopics(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const contrib of this.contributions.values()) {
      if (contrib.topics) Object.assign(result, contrib.topics);
    }
    return result;
  }

  /** Flattened role contribution list from all registered plugins. */
  getRoles(): WorkspaceRoleContribution[] {
    const result: WorkspaceRoleContribution[] = [];
    for (const contrib of this.contributions.values()) {
      if (contrib.roles) result.push(...contrib.roles);
    }
    return result;
  }

  /** Flattened worker contribution list from all registered plugins. */
  getWorkers(): WorkerContribution[] {
    const result: WorkerContribution[] = [];
    for (const contrib of this.contributions.values()) {
      if (contrib.workers) result.push(...contrib.workers);
    }
    return result;
  }

  /** Flattened permission layer list from all registered plugins. */
  getPermissionLayers(): PermissionLayer[] {
    const result: PermissionLayer[] = [];
    for (const contrib of this.contributions.values()) {
      if (contrib.permissionLayers) result.push(...contrib.permissionLayers);
    }
    return result;
  }

  /** Commands contributed by all registered plugins, each tagged with its pluginId. */
  getCommands(): Array<{ pluginId: string; command: CommandContribution }> {
    const result: Array<{ pluginId: string; command: CommandContribution }> = [];
    for (const [pluginId, contrib] of this.contributions) {
      if (contrib.commands) {
        for (const command of contrib.commands) {
          result.push({ pluginId, command });
        }
      }
    }
    return result;
  }

  /** Hooks contributed by all registered plugins, each tagged with its pluginId. */
  getHooks(): Array<{ pluginId: string; hook: HookContribution }> {
    const result: Array<{ pluginId: string; hook: HookContribution }> = [];
    for (const [pluginId, contrib] of this.contributions) {
      if (contrib.hooks) {
        for (const hook of contrib.hooks) {
          result.push({ pluginId, hook });
        }
      }
    }
    return result;
  }

  /**
   * Prompt templates from registered plugins.
   * Pass `pluginId` to get templates for a specific plugin, or omit to get all.
   */
  getPromptTemplates(pluginId?: string): Array<{ pluginId: string; template: PromptTemplateContribution }> {
    const result: Array<{ pluginId: string; template: PromptTemplateContribution }> = [];
    for (const [id, contrib] of this.contributions) {
      if (pluginId !== undefined && id !== pluginId) continue;
      if (contrib.promptTemplates) {
        for (const template of contrib.promptTemplates) {
          result.push({ pluginId: id, template });
        }
      }
    }
    return result;
  }

  /**
   * Start all contributed workers using the provided Redis connection.
   * Workers are tracked internally for graceful shutdown via stopWorkers().
   */
  startWorkers(connection: Redis): Array<{ worker: Worker; name: string }> {
    const handles: Array<{ worker: Worker; name: string }> = [];
    for (const workerContrib of this.getWorkers()) {
      const worker = workerContrib.factory(connection);
      handles.push({ worker, name: workerContrib.name });
      this.activeWorkers.push({ worker, name: workerContrib.name });
    }
    return handles;
  }

  /** Gracefully close all workers started via startWorkers(). */
  async stopWorkers(): Promise<void> {
    await Promise.allSettled(this.activeWorkers.map(({ worker }) => worker.close()));
    this.activeWorkers = [];
  }

  /** Reset registry state — for use in tests only. */
  clear(): void {
    this.contributions.clear();
    this.activeWorkers = [];
  }
}

export const pluginContributionRegistry = new PluginContributionRegistry();
