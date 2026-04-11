/**
 * Workflow Generator — Phase 3
 *
 * Detects repeated skill invocation sequences across tasks and proposes
 * workflow templates for patterns that appear 5+ times.
 * Approved proposals insert into the workflowTemplates table (already exists).
 *
 * Gate: learning.generativeExtension feature flag + AUTONOMOUS+ tier.
 */

import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { workflowsService } from '../../workflows/workflows.service';
import { logger } from '../../../config/logger';
import type { ImprovementProposal } from '../analyzers/skill-weight-analyzer';

const MIN_PATTERN_OCCURRENCES = 5;
const SEQUENCE_WINDOW_DAYS = 14;

interface SkillSequence {
  steps: string[];       // ordered skill IDs
  occurrences: number;
  workspaceId: string;
}

/**
 * Detect repeated skill sequences from the learning_observations payload.
 * Skill sequences are recorded as 'skill_sequence' observations by the task observer.
 */
export async function detectRepeatedSequences(workspaceId: string): Promise<SkillSequence[]> {
  const since = new Date(Date.now() - SEQUENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Query sequences recorded as 'skill_sequence' type observations
  const rows = await db
    .select({
      sequence: sql<string>`payload->>'sequence'`,
      count: sql<number>`count(*)::int`,
    })
    .from(learningObservations)
    .where(and(
      eq(learningObservations.workspaceId, workspaceId),
      eq(learningObservations.observationType, 'skill_sequence'),
      gte(learningObservations.createdAt, since),
    ))
    .groupBy(sql`payload->>'sequence'`);

  return rows
    .filter((r) => r.count >= MIN_PATTERN_OCCURRENCES && r.sequence)
    .map((r) => {
      let steps: string[] = [];
      try { steps = JSON.parse(r.sequence); } catch { /* skip malformed */ }
      return { steps, occurrences: r.count, workspaceId };
    })
    .filter((s) => s.steps.length >= 2);
}

/**
 * Generate an ImprovementProposal of type 'workflow_template' for a repeated sequence.
 */
export function proposeWorkflowTemplate(sequence: SkillSequence): ImprovementProposal {
  const templateName = `auto:${sequence.steps.join('→').slice(0, 60)}`;

  const definition = {
    steps: sequence.steps.map((skillId, i) => ({
      id: `step-${i + 1}`,
      type: 'skill' as const,
      skillId,
      dependsOn: i > 0 ? [`step-${i}`] : [],
    })),
  };

  return {
    workspaceId: sequence.workspaceId,
    proposalType: 'workflow_template',
    changeType: 'structural',
    description: `Detected repeated skill sequence (${sequence.occurrences}× in ${SEQUENCE_WINDOW_DAYS} days): ${sequence.steps.join(' → ')}. Proposing reusable workflow template.`,
    evidence: [
      `occurrences=${sequence.occurrences}`,
      `steps=${sequence.steps.join(',')}`,
      `window_days=${SEQUENCE_WINDOW_DAYS}`,
    ],
    beforeValue: null,
    afterValue: {
      templateName,
      definition,
      stepCount: sequence.steps.length,
    },
    confidence: Math.min(0.9, 0.5 + sequence.occurrences * 0.05),
  };
}

/**
 * Apply an approved workflow_template proposal by inserting into workflowTemplates.
 * Called from improvement-pipeline.ts when proposal is approved/auto-applied.
 */
export async function applyWorkflowTemplate(
  workspaceId: string,
  templateData: {
    templateName: string;
    definition: unknown;
  },
  callerId = 'system:learning-engine',
): Promise<void> {
  const result = await workflowsService.create(workspaceId, callerId, {
    name: templateData.templateName,
    description: 'Auto-generated workflow template from repeated skill pattern',
    definition: templateData.definition,
  });

  if (result.ok) {
    logger.info({ workspaceId, templateName: templateData.templateName }, 'Workflow template created from repeated pattern');
  } else {
    logger.warn({ workspaceId, error: result.error.message }, 'Failed to create workflow template');
  }
}
