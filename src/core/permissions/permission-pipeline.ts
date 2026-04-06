import type { PermissionContext, PermissionLayer, PermissionResult } from './types';

/**
 * 5-layer permission decision pipeline.
 *
 * Layers run in order. First non-passthrough result wins.
 * Default layers (in order):
 *   1. Mode layer    — checks PermissionMode (bypassPermissions → allow, plan → deny writes)
 *   2. Rules layer   — static allow/deny rules from workspace settings
 *   3. Hook layer    — lifecycle hooks can approve or deny
 *   4. Classifier    — AI classifier for ambiguous cases (optional, expensive)
 *   5. User prompt   — last resort: surface to human for approval
 *
 * Register layers via addLayer(). Layers run in registration order.
 */
export class PermissionPipeline {
  private layers: PermissionLayer[] = [];

  addLayer(layer: PermissionLayer): this {
    this.layers.push(layer);
    return this;
  }

  removeLayer(name: string): this {
    this.layers = this.layers.filter(l => l.name !== name);
    return this;
  }

  async check(ctx: PermissionContext): Promise<PermissionResult> {
    for (const layer of this.layers) {
      const result = await layer.check(ctx);
      if (result.behavior !== 'passthrough') {
        return { ...result, decisionLayer: layer.name } as PermissionResult;
      }
    }
    // All layers passed through — allow by default
    return { behavior: 'allow', decisionLayer: 'default' };
  }
}

/** Singleton pipeline for the application. Layers registered at startup. */
export const permissionPipeline = new PermissionPipeline();
