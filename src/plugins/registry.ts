/**
 * Globally-contributing plugin registry.
 *
 * Lists every plugin whose `contributions` block is applied at app startup.
 * Workers start once per process. Topics, roles, and permission layers are
 * merged into their respective global singletons during bootstrap Step 12.5.
 *
 * To add a new contributing plugin:
 *   1. Define its contributions block in the manifest
 *   2. Import the manifest here and add it to CONTRIBUTION_PLUGINS
 */

import type { PluginManifest } from '../modules/plugins/plugin-manifest';
import { supplyChainManifest } from './supply-chain/manifest';
import { erpBcManifest } from './erp-bc/manifest';

export const CONTRIBUTION_PLUGINS: PluginManifest[] = [
  supplyChainManifest,
  erpBcManifest,
];
