import { z } from 'zod';

export const listApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'rolled_back', 'pending_approval']).optional(),
  kind: z.enum(['memory_proposal', 'execution_plan']).optional(),
});

export const approvalIdParamSchema = z.object({
  kind: z.enum(['memory_proposal', 'execution_plan']),
  id: z.string().uuid(),
});

export const approvalActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'rollback']),
  reason: z.string().optional(),
});
