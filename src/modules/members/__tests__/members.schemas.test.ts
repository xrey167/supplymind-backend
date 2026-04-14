import { describe, it, expect } from 'bun:test';
import { createInvitationSchema, updateRoleSchema } from '../members.schemas';

describe('members.schemas', () => {
  const supplyChainRoles = [
    'procurement_manager',
    'logistics_coordinator',
    'warehouse_operator',
    'finance_approver',
  ] as const;

  it('accepts supply-chain roles for invitation creation', () => {
    for (const role of supplyChainRoles) {
      const parsed = createInvitationSchema.parse({ role });
      expect(parsed.role).toBe(role);
    }
  });

  it('accepts supply-chain roles for role updates', () => {
    for (const role of supplyChainRoles) {
      const parsed = updateRoleSchema.parse({ role });
      expect(parsed.role).toBe(role);
    }
  });
});
