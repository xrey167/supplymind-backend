/**
 * Improvement Pipeline
 *
 * State machine for improvement proposals:
 *   pending → auto_applied | approved | rejected → rolled_back
 *
 * Mirrors the memory proposal pattern from memory.service.ts.
 */

import { db } from '../../infra/db/client';
import { improvementProposals } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import type { ImprovementProposal } from './analyzers/skill-weight-analyzer';

type ProposalRow = typeof improvementProposals.$inferSelect;

export class ImprovementPipeline {
  /** Persist a new proposal (status: pending). Returns the proposal ID. */
  async create(proposal: ImprovementProposal): Promise<string> {
    const rows = await db
      .insert(improvementProposals)
      .values({
        workspaceId: proposal.workspaceId,
        pluginId: proposal.pluginId ?? null,
        proposalType: proposal.proposalType,
        changeType: proposal.changeType,
        description: proposal.description,
        evidence: proposal.evidence as any,
        beforeValue: proposal.beforeValue as any,
        afterValue: proposal.afterValue as any,
        confidence: proposal.confidence,
        status: 'pending',
      })
      .returning({ id: improvementProposals.id });

    return rows[0]!.id;
  }

  /** Auto-apply a proposal (trust tier allows it). */
  async autoApply(proposalId: string): Promise<void> {
    const rows = await db
      .select()
      .from(improvementProposals)
      .where(eq(improvementProposals.id, proposalId))
      .limit(1);

    if (rows.length === 0) throw new Error(`Proposal ${proposalId} not found`);
    const proposal = rows[0]!;

    // Capture rollback snapshot
    await db
      .update(improvementProposals)
      .set({
        status: 'auto_applied',
        autoAppliedAt: new Date(),
        rollbackData: proposal.beforeValue as any,
      })
      .where(eq(improvementProposals.id, proposalId));

    await this.applyChange(proposal);

    await eventBus.publish(Topics.LEARNING_PROPOSAL_APPLIED, {
      proposalId,
      workspaceId: proposal.workspaceId,
      proposalType: proposal.proposalType,
      autoApplied: true,
    }, { source: 'improvement-pipeline' });

    logger.info({ proposalId, proposalType: proposal.proposalType }, 'Improvement proposal auto-applied');
  }

  /** Human approval path. */
  async approve(proposalId: string): Promise<void> {
    const rows = await db
      .select()
      .from(improvementProposals)
      .where(eq(improvementProposals.id, proposalId))
      .limit(1);

    if (rows.length === 0) throw new Error(`Proposal ${proposalId} not found`);
    const proposal = rows[0]!;
    if (proposal.status !== 'pending') throw new Error(`Proposal ${proposalId} is not pending (status: ${proposal.status})`);

    await db
      .update(improvementProposals)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        rollbackData: proposal.beforeValue as any,
      })
      .where(eq(improvementProposals.id, proposalId));

    await this.applyChange(proposal);

    await eventBus.publish(Topics.LEARNING_PROPOSAL_APPROVED, {
      proposalId,
      workspaceId: proposal.workspaceId,
      proposalType: proposal.proposalType,
    }, { source: 'improvement-pipeline' });
  }

  /** Human rejection. */
  async reject(proposalId: string): Promise<void> {
    await db
      .update(improvementProposals)
      .set({ status: 'rejected', rejectedAt: new Date() })
      .where(eq(improvementProposals.id, proposalId));

    const rows = await db
      .select({ workspaceId: improvementProposals.workspaceId, proposalType: improvementProposals.proposalType })
      .from(improvementProposals)
      .where(eq(improvementProposals.id, proposalId))
      .limit(1);

    if (rows[0]) {
      await eventBus.publish(Topics.LEARNING_PROPOSAL_REJECTED, {
        proposalId,
        workspaceId: rows[0].workspaceId,
        proposalType: rows[0].proposalType,
      }, { source: 'improvement-pipeline' });
    }
  }

  /** Rollback an applied proposal. */
  async rollback(proposalId: string): Promise<void> {
    const rows = await db
      .select()
      .from(improvementProposals)
      .where(eq(improvementProposals.id, proposalId))
      .limit(1);

    if (rows.length === 0) throw new Error(`Proposal ${proposalId} not found`);
    const proposal = rows[0]!;

    if (!['auto_applied', 'approved'].includes(proposal.status)) {
      throw new Error(`Cannot rollback proposal in status: ${proposal.status}`);
    }

    // Reverse the change using rollback_data as the "after" value
    if (proposal.rollbackData) {
      await this.applyRollback(proposal);
    }

    await db
      .update(improvementProposals)
      .set({ status: 'rolled_back' })
      .where(eq(improvementProposals.id, proposalId));

    logger.info({ proposalId, proposalType: proposal.proposalType }, 'Improvement proposal rolled back');
  }

  /** List pending proposals for a workspace. */
  async listPending(workspaceId: string): Promise<ProposalRow[]> {
    return db
      .select()
      .from(improvementProposals)
      .where(eq(improvementProposals.workspaceId, workspaceId))
      .orderBy(improvementProposals.createdAt);
  }

  private async applyChange(proposal: ProposalRow): Promise<void> {
    switch (proposal.proposalType) {
      case 'skill_weight': {
        const after = proposal.afterValue as { skillId: string; priority: number } | null;
        if (after?.skillId) {
          // Update skill priority in DB if skill_definitions table exists
          try {
            const { skillRegistry } = await import('../skills/skills.registry');
            const skill = skillRegistry.get(after.skillId);
            if (skill) {
              skillRegistry.register({ ...skill, priority: after.priority });
            }
          } catch { /* skill not in registry */ }
        }
        break;
      }
      case 'memory_threshold': {
        // Store updated threshold in workspace settings
        const after = proposal.afterValue as { minConfidence: number } | null;
        if (after) {
          try {
            const { workspaceSettingsService } = await import('../settings/workspace-settings/workspace-settings.service');
            const { WorkspaceSettingKeys: K } = await import('../settings/workspace-settings/workspace-settings.schemas');
            await workspaceSettingsService.set(
              proposal.workspaceId,
              K.LEARNING_MEMORY_EXTRACTION_THRESHOLD,
              after.minConfidence,
            );
          } catch { /* settings service may not support this key yet */ }
        }
        break;
      }
      default:
        // routing_rule, prompt_update — stored as proposals for manual review in UI
        break;
    }
  }

  private async applyRollback(proposal: ProposalRow): Promise<void> {
    switch (proposal.proposalType) {
      case 'skill_weight': {
        const before = proposal.rollbackData as { skillId: string; priority: number } | null;
        if (before?.skillId) {
          try {
            const { skillRegistry } = await import('../skills/skills.registry');
            const skill = skillRegistry.get(before.skillId);
            if (skill) {
              skillRegistry.register({ ...skill, priority: before.priority });
            }
          } catch { /* skill not in registry */ }
        }
        break;
      }
      default:
        break;
    }
  }
}

export const improvementPipeline = new ImprovementPipeline();
