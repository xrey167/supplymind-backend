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
 */

import type { PermissionLayer } from '../../core/permissions/types';
import type { Role } from '../../core/security/rbac';
import type { GatewayRequest, GatewayResult } from '../../core/gateway/gateway.types';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

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

/** A gateway op handler contributed by a plugin. */
export interface GatewayOpContribution {
  op: string;
  handler: (req: GatewayRequest) => Promise<GatewayResult>;
}

/** All contribution types a plugin manifest can declare. */
export interface PluginContributions {
  topics?: PluginTopicContributions;
  roles?: WorkspaceRoleContribution[];
  workers?: WorkerContribution[];
  permissionLayers?: PermissionLayer[];
  gatewayOps?: GatewayOpContribution[];
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

  /** Flattened gateway op contribution list from all registered plugins. */
  getGatewayOps(): GatewayOpContribution[] {
    const result: GatewayOpContribution[] = [];
    for (const contrib of this.contributions.values()) {
      if (contrib.gatewayOps) result.push(...contrib.gatewayOps);
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
