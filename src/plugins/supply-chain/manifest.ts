/**
 * Supply Chain plugin manifest.
 *
 * Declares global platform contributions (topics, roles, permission layer) that
 * apply across all workspaces from the moment the app boots. Per-workspace skills
 * and hooks are installed separately via the plugin installation flow.
 */

import type { PluginManifest } from '../../modules/plugins/plugin-manifest';
import { SupplyChainTopics } from './topics';
import { supplyChainRoleLayer, SUPPLY_CHAIN_ROLE_ENTRIES } from './roles';

export const supplyChainManifest: PluginManifest = {
  id: 'supply-chain',
  name: 'Supply Chain',
  version: '1.0.0',
  description: 'Supply chain domain — orders, shipments, inventory, and supplier management',
  author: 'SupplyMind',

  contributions: {
    topics: { ...SupplyChainTopics },
    roles: SUPPLY_CHAIN_ROLE_ENTRIES,
    permissionLayers: [supplyChainRoleLayer],
  },
};
