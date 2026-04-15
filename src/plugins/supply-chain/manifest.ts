/**
 * Supply Chain plugin manifest.
 *
 * Declares global platform contributions (topics, roles, permission layer, hooks,
 * and prompt templates) that apply across all workspaces from the moment the app
 * boots. Per-workspace skills and hooks are installed separately via the plugin
 * installation flow.
 */

import type { PluginManifest } from '../../modules/plugins/plugin-manifest';
import { SupplyChainTopics } from './topics';
import { supplyChainRoleLayer, SUPPLY_CHAIN_ROLE_ENTRIES } from './roles';
import { logger } from '../../config/logger';

const SC_TOOL_PREFIXES = ['purchase_order.', 'shipment.', 'inventory.', 'supplier.'];

export const supplyChainManifest: PluginManifest = {
  id: 'supply-chain',
  name: 'Supply Chain',
  version: '1.0.0',
  description: 'Supply chain domain — orders, shipments, inventory, and supplier management',
  author: 'SupplyMind',

  domainPack: {
    defaultPermissionMode: 'ask',
    agentProfiles: [
      {
        name: 'Supply Chain Executor',
        category: 'executor',
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        systemPrompt:
          'You are a supply chain execution agent. Your job is to carry out specific supply chain tasks: placing purchase orders, updating shipment records, and managing inventory adjustments. Always verify quantities and supplier details before acting. Flag anomalies for human review.',
        permissionMode: 'ask',
        isDefault: false,
        metadata: { plugin: 'supply-chain' },
      },
      {
        name: 'Supply Chain Planner',
        category: 'planner',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        systemPrompt:
          'You are a supply chain planning agent. Analyse demand forecasts, inventory levels, and supplier lead times to produce actionable procurement and logistics plans. Coordinate with executor agents for implementation.',
        permissionMode: 'auto',
        isDefault: false,
        metadata: { plugin: 'supply-chain' },
      },
    ],
    approvalGates: [
      { toolPattern: 'purchase_order.*', riskLevel: 'medium' },
      { toolPattern: 'supplier.*',       riskLevel: 'medium' },
      { toolPattern: 'shipment.*',       riskLevel: 'low' },
      { toolPattern: 'inventory.*',      riskLevel: 'low' },
    ],
  },

  contributions: {
    topics: { ...SupplyChainTopics },
    roles: SUPPLY_CHAIN_ROLE_ENTRIES,
    permissionLayers: [supplyChainRoleLayer],

    hooks: [
      {
        name: 'log-sc-tool-use',
        event: 'post_tool_use',
        handler: async (_event, payload) => {
          const p = payload as { toolName?: string };
          if (SC_TOOL_PREFIXES.some((prefix) => p.toolName?.startsWith(prefix))) {
            logger.debug({ toolName: p.toolName }, '[supply-chain] SC tool used');
          }
        },
      },
    ],

    promptTemplates: [
      {
        name: 'low-stock-reorder',
        description: 'Draft a reorder request for a low-stock item',
        content:
          'Draft a purchase order reorder request for SKU {{sku}}. ' +
          'Current stock: {{current_stock}} units. ' +
          'Reorder threshold: {{reorder_threshold}} units. ' +
          'Preferred supplier: {{supplier_name}}.',
        tags: ['supply-chain', 'purchasing'],
      },
      {
        name: 'shipment-delay-update',
        description: 'Notify stakeholders of a shipment delay',
        content:
          'Shipment {{shipment_id}} from {{supplier_name}} is delayed. ' +
          'Expected delivery: {{expected_date}}. ' +
          'Reason: {{delay_reason}}. ' +
          'Suggest mitigation steps.',
        tags: ['supply-chain', 'logistics'],
      },
      {
        name: 'supplier-risk-summary',
        description: 'Summarize supplier risk for a given supplier',
        content:
          'Provide a risk summary for supplier {{supplier_name}} (ID: {{supplier_id}}). ' +
          'Include delivery performance, price stability, and any recent alerts.',
        tags: ['supply-chain', 'risk'],
      },
    ],
  },
};
