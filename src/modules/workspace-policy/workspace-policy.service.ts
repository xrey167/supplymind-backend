import { workspacePolicyRepo } from './workspace-policy.repo';
import { PolicyEngine } from './workspace-policy.engine';
import type { Policy, PolicyContext, PolicyVerdict } from './workspace-policy.types';

export const workspacePolicyService = {
  async evaluate(workspaceId: string, ctx: Omit<PolicyContext, 'workspaceId'>): Promise<PolicyVerdict> {
    const policies = await workspacePolicyRepo.listForWorkspace(workspaceId);
    const engine = new PolicyEngine(policies);
    return engine.evaluate({ workspaceId, ...ctx });
  },

  async list(workspaceId: string): Promise<Policy[]> {
    return workspacePolicyRepo.listForWorkspace(workspaceId);
  },

  async getById(id: string, workspaceId: string): Promise<Policy | null> {
    return workspacePolicyRepo.getById(id, workspaceId);
  },

  async create(
    workspaceId: string,
    input: Omit<Policy, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>,
  ): Promise<Policy> {
    return workspacePolicyRepo.create(workspaceId, input);
  },

  async update(
    id: string,
    workspaceId: string,
    patch: Partial<Omit<Policy, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Policy | null> {
    return workspacePolicyRepo.update(id, workspaceId, patch);
  },

  async delete(id: string, workspaceId: string): Promise<boolean> {
    return workspacePolicyRepo.delete(id, workspaceId);
  },
};
