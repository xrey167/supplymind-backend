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
import { detectSkillGaps, generateSkillForGap } from './generators/skill-generator';
import { findUnderperformingAgents, generatePromptVariant } from './generators/prompt-optimizer';
import { detectRepeatedSequences, proposeWorkflowTemplate } from './generators/workflow-generator';
import { featureFlagsService } from '../feature-flags/feature-flags.service';
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

    // Phase 3: Generative self-extension (feature-flagged + AUTONOMOUS+ tier only)
    const generativeEnabled = await featureFlagsService.isEnabled(workspaceId, 'learning.generativeExtension').catch(() => false);
    const tierConfig = await trustTierService.getTierConfig(workspaceId);
    const isAutonomousPlus = tierConfig.autoApply.newSkills; // true only for autonomous/trusted

    if (generativeEnabled && isAutonomousPlus) {
      const generativeProposals = await this.runGenerativePhase(workspaceId);
      allProposals.push(...generativeProposals);
    }

    // Get existing auto-applied count for today (used for maxDailyAutoChanges check)
    let autoAppliedToday = await improvementPipeline.countAutoAppliedToday(workspaceId);
    const maxAutoChanges = tierConfig.guards.maxDailyAutoChanges;

    let proposed = 0;
    let applied = 0;

    for (const proposal of allProposals) {
      try {
        const canAutoApply = await trustTierService.canAutoApply(workspaceId, proposal.proposalType);

        const id = await improvementPipeline.create(proposal);
        proposed++;

        if (canAutoApply) {
          // Enforce daily auto-change limit
          if (maxAutoChanges > 0 && autoAppliedToday >= maxAutoChanges) {
            // Over budget — emit as pending for human review instead
            await eventBus.publish(Topics.LEARNING_PROPOSAL_CREATED, {
              proposalId: id,
              workspaceId,
              proposalType: proposal.proposalType,
              changeType: proposal.changeType,
            }, { source: 'learning-engine' });
            logger.info(
              { workspaceId, proposalId: id, maxAutoChanges, autoAppliedToday },
              'Auto-apply skipped: daily limit reached, queued for human review',
            );
          } else {
            await improvementPipeline.autoApply(id);
            applied++;
            autoAppliedToday++;
          }
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

  /**
   * Phase 3: detect gaps and generate proposals via LLM.
   * Only called when learning.generativeExtension is enabled + AUTONOMOUS+ tier.
   */
  private async runGenerativePhase(workspaceId: string): Promise<ImprovementProposal[]> {
    const proposals: ImprovementProposal[] = [];

    try {
      // Skill gap detection
      const gaps = await detectSkillGaps(workspaceId);
      for (const gap of gaps) {
        const proposal = await generateSkillForGap(gap, '').catch(() => null);
        if (proposal) proposals.push(proposal);
      }
    } catch (err) {
      logger.warn({ workspaceId, error: err }, 'Phase 3: skill gap generation failed');
    }

    try {
      // Underperforming agent prompt optimization
      const underperforming = await findUnderperformingAgents(workspaceId);
      for (const perf of underperforming) {
        // promptsService lookup would happen here; we skip if no prompt available
        const proposal = await generatePromptVariant(workspaceId, perf, '', '').catch(() => null);
        if (proposal) proposals.push(proposal);
      }
    } catch (err) {
      logger.warn({ workspaceId, error: err }, 'Phase 3: prompt optimization failed');
    }

    try {
      // Workflow template generation from repeated sequences
      const sequences = await detectRepeatedSequences(workspaceId);
      for (const seq of sequences) {
        proposals.push(proposeWorkflowTemplate(seq));
      }
    } catch (err) {
      logger.warn({ workspaceId, error: err }, 'Phase 3: workflow template generation failed');
    }

    return proposals;
  }
}

export const learningEngine = new LearningEngine();
