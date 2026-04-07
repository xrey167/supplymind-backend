// src/plugins/erp-bc/hitl/approval-schemas.ts

import { z } from 'zod';

export const bcWriteActionSchema = z.object({
  actionName: z.enum(['postInvoice', 'deleteVendor', 'cancelOrder', 'modifyGLEntry']),
  entityType: z.enum(['purchaseOrders', 'vendors', 'glEntries', 'items', 'customers']),
  entityId: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string(),
});

export type BcWriteAction = z.infer<typeof bcWriteActionSchema>;
