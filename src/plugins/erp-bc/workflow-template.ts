// src/plugins/erp-bc/workflow-template.ts

import type { WorkflowDefinition } from '../../modules/workflows/workflows.types';

export const purchaseOrderSyncWorkflow: WorkflowDefinition = {
  id: 'erp-bc:purchase-order-sync',
  name: 'ERP BC — Purchase Order Sync',
  description: 'Sync Business Central purchase orders then surface any exceptions for review',
  steps: [
    {
      id: 'sync',
      skillId: 'erp-bc:sync-now',
      args: {
        entityType: 'purchaseOrders',
        workspaceId: '${input.workspaceId}',
        installationId: '${input.installationId}',
      },
      onError: 'retry',
      maxRetries: 3,
    },
    {
      id: 'check-exceptions',
      skillId: 'echo',
      args: { decision: 'check_exceptions', syncResult: '${steps.sync.result}' },
      dependsOn: ['sync'],
    },
  ],
  maxConcurrency: 1,
};
