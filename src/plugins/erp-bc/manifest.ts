// src/plugins/erp-bc/manifest.ts

import type { PluginManifest } from '../../modules/plugins/plugin-manifest';
import { syncNow } from './skills/sync-now';
import { getEntity } from './skills/get-entity';
import { postAction } from './skills/post-action';

export const erpBcManifest: PluginManifest = {
  id: 'erp-bc',
  name: 'ERP Sync — Business Central',
  version: '1.0.0',
  description: 'Synchronise Business Central entities and execute approved write actions',
  author: 'SupplyMind',
  skills: [
    {
      name: 'erp-bc:sync-now',
      description: 'Trigger immediate sync for a Business Central entity type',
      inputSchema: {
        type: 'object',
        required: ['workspaceId', 'entityType', 'installationId'],
        properties: {
          workspaceId:    { type: 'string' },
          entityType:     { type: 'string', enum: ['purchaseOrders', 'vendors', 'glEntries', 'items', 'customers'] },
          installationId: { type: 'string' },
        },
      },
      handler: syncNow,
    },
    {
      name: 'erp-bc:get-entity',
      description: 'Fetch a single Business Central entity by id',
      inputSchema: {
        type: 'object',
        required: ['entityType', 'entityId', 'config'],
        properties: {
          entityType: { type: 'string' },
          entityId:   { type: 'string' },
          config:     { type: 'object' },
        },
      },
      handler: getEntity,
    },
    {
      name: 'erp-bc:post-action',
      description: 'Execute a Business Central write action (requires HITL approval for destructive operations)',
      inputSchema: {
        type: 'object',
        required: ['actionName', 'entityType', 'entityId', 'config'],
        properties: {
          actionName:      { type: 'string' },
          entityType:      { type: 'string' },
          entityId:        { type: 'string' },
          config:          { type: 'object' },
          payload:         { type: 'object' },
          _calledFromPlan: { type: 'boolean' },
        },
      },
      handler: postAction,
    },
  ],
};
