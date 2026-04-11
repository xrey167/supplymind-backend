/**
 * Learning Engine
 *
 * Core analysis cycle. For each active workspace, loads recent observations,
 * runs analyzers, and routes proposals through the trust-tier pipeline.
 * Called by the BullMQ learning-cycle job (1h default interval).
 */

import { db } from '../../infra/db/client';
import { workspaces } from '../../infra/db/schema';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import { trustTierService } from './trust-tier.service';
import { improvementPipeline } from './improvement-pipeline';
import { analyzeSkillWeights } from './analyzers/skill-weight-analyzer';
import { analyzeRouting } from './analyzers/routing-analyzer';
import { analyzeMemoryQuality } from './analyzers/memory-analyzer';
import type { ImprovementProposal } from './analyzers/skill-weight-analyzer';

export class LearningEngine {
  /**
   * Run one analysis cycle across all workspaces.
   * Called by the BullMQ learning-cycle job.
   */
  async runCycle(): Promise<void> {
    const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
    let totalProposed = 0;
    let totalApplied = 0;

    for (const ws of allWorkspaces) {
      try {
        const { proposed, applied } = await this.runCycleForWorkspace(ws.id);
        totalProposed += proposed;
        totalApplied += applied;
      } catch (err) {
        logger.error({ workspaceId: ws.id, error: err }, 'Learning cycle failed for workspace');
      }
    }

    logger.info({ workspaces: allWorkspaces.length, totalProposed, totalApplied }, 'Learning cycle completed');
  }

  /**
   * Run analysis for a single workspace.
   */
  async runCycleForWorkspace(workspaceId: string): Promise<{ proposed: number; applied: number }> {
    // Run all analyzers in parallel
    const [skillProposals, routingProposals, memoryProposals] = await Promise.all([
      analyzeSkillWeights(workspaceId),
      analyzeRouting(workspaceId),
      analyzeMemoryQuality(workspaceId),
    ]);

    const allProposals: ImprovementProposal[] = [
      ...skillProposals,
      ...routingProposals,
      ...memoryProposals,
    ];

    let proposed = 0;
    let applied = 0;

    for (const proposal of allProposals) {
      try {
        const canAutoApply = await trustTierService.canAutoApply(workspaceId, proposal.proposalType);

        const id = await improvementPipeline.create(proposal);
        proposed++;

        if (canAutoApply) {
          await improvementPipeline.autoApply(id);
          applied++;
        } else {
          // Emit so the frontend can surface pending proposals
          await eventBus.publish(Topics.LEARNING_PROPOSAL_CREATED, {
            proposalId: id,
            workspaceId,
            proposalType: proposal.proposalType,
            changeType: proposal.changeType,
          }, { source: 'learning-engine' });
        }
      } catch (err) {
        logger.warn({ workspaceId, proposalType: proposal.proposalType, error: err }, 'Proposal processing failed');
      }
    }

    await eventBus.publish(Topics.ADAPTATION_AGENT_CYCLE_COMPLETED, {
      workspaceId,
      proposalsGenerated: proposed,
      appliedCount: applied,
    }, { source: 'learning-engine' });

    return { proposed, applied };
  }
}

export const learningEngine = new LearningEngine();
