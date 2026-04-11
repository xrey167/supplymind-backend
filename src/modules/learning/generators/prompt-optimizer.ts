/**
 * Prompt Optimizer — Phase 3
 *
 * Analyzes agent system prompts where task completion rate is below threshold,
 * generates an optimized variant via LLM, and creates a workflow A/B test
 * using the existing orchestration engine's DecisionStep mechanism.
 *
 * Gate: learning.generativeExtension feature flag + AUTONOMOUS+ tier.
 */

import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AnthropicRawRuntime } from '../../../infra/ai/anthropic';
import { promptsService } from '../../prompts/prompts.service';
import { logger } from '../../../config/logger';
import type { ImprovementProposal } from '../analyzers/skill-weight-analyzer';

const COMPLETION_THRESHOLD = 0.8; // below 80% → consider optimization
const MIN_TASK_SAMPLE = 10;
const OPTIMIZATION_MODEL = 'claude-sonnet-4-6';

export interface PromptPerformance {
  agentId: string;
  completionRate: number;
  taskCount: number;
  errorCount: number;
}

/**
 * Find agents with below-threshold task completion rates over the last 7 days.
 */
export async function findUnderperformingAgents(workspaceId: string): Promise<PromptPerformance[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [completed, errors] = await Promise.all([
    db
      .select({
        agentId: sql<string>`payload->>'agentId'`,
        count: sql<number>`count(*)::int`,
      })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'task_completed'),
        gte(learningObservations.createdAt, since),
      ))
      .groupBy(sql`payload->>'agentId'`),
    db
      .select({
        agentId: sql<string>`payload->>'agentId'`,
        count: sql<number>`count(*)::int`,
      })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'task_error'),
        gte(learningObservations.createdAt, since),
      ))
      .groupBy(sql`payload->>'agentId'`),
  ]);

  const completedMap = new Map(completed.map((r) => [r.agentId, r.count]));
  const errorMap = new Map(errors.map((r) => [r.agentId, r.count]));

  const allAgentIds = new Set([...completedMap.keys(), ...errorMap.keys()].filter(Boolean));
  const results: PromptPerformance[] = [];

  for (const agentId of allAgentIds) {
    const taskCount = (completedMap.get(agentId) ?? 0) + (errorMap.get(agentId) ?? 0);
    const errorCount = errorMap.get(agentId) ?? 0;
    if (taskCount < MIN_TASK_SAMPLE) continue;

    const completionRate = (taskCount - errorCount) / taskCount;
    if (completionRate < COMPLETION_THRESHOLD) {
      results.push({ agentId, completionRate, taskCount, errorCount });
    }
  }

  return results;
}

/**
 * Generate an optimized system prompt variant for an agent.
 * Returns an ImprovementProposal of type 'prompt_update'.
 */
export async function generatePromptVariant(
  workspaceId: string,
  performance: PromptPerformance,
  currentSystemPrompt: string,
  domainContext: string,
): Promise<ImprovementProposal | null> {
  if (!currentSystemPrompt) return null;

  const runtime = new AnthropicRawRuntime();

  const result = await runtime.run({
    model: OPTIMIZATION_MODEL,
    messages: [{
      role: 'user',
      content: `This agent system prompt has a ${Math.round(performance.completionRate * 100)}% task completion rate (${performance.errorCount} errors out of ${performance.taskCount} tasks).

Current system prompt:
---
${currentSystemPrompt.slice(0, 2000)}
---

${domainContext ? `Domain context:\n${domainContext}\n---\n` : ''}

Rewrite the system prompt to improve task completion rate. Focus on:
1. Clearer instructions for handling edge cases
2. Better error recovery guidance
3. More explicit about when to ask for clarification vs proceeding

Return ONLY the improved system prompt, no explanation.`,
    }],
    maxTokens: 1000,
    temperature: 0.4,
  });

  if (!result.ok) {
    logger.warn({ agentId: performance.agentId, error: result.error.message }, 'Prompt optimization LLM call failed');
    return null;
  }

  const optimizedPrompt = result.value.content.trim();
  if (!optimizedPrompt || optimizedPrompt === currentSystemPrompt) return null;

  return {
    workspaceId,
    proposalType: 'prompt_update',
    changeType: 'structural',
    description: `Optimized system prompt for agent ${performance.agentId} (${Math.round(performance.completionRate * 100)}% completion rate, ${performance.errorCount} errors in ${performance.taskCount} tasks).`,
    evidence: [
      `completion_rate=${performance.completionRate.toFixed(2)}`,
      `error_count=${performance.errorCount}`,
      `task_count=${performance.taskCount}`,
      `agent_id=${performance.agentId}`,
    ],
    beforeValue: { agentId: performance.agentId, systemPrompt: currentSystemPrompt.slice(0, 500) },
    afterValue: { agentId: performance.agentId, systemPrompt: optimizedPrompt.slice(0, 500), fullPrompt: optimizedPrompt },
    confidence: Math.min(0.85, 1 - performance.completionRate + 0.2),
  };
}

/**
 * Apply an approved prompt_update proposal by creating a new prompt version
 * via the prompts service and recording it for the agent.
 */
export async function applyPromptUpdate(
  workspaceId: string,
  agentId: string,
  optimizedPrompt: string,
  callerId = 'system:learning-engine',
): Promise<void> {
  const result = await promptsService.create({
    workspaceId,
    name: `auto-optimized:${agentId}:${Date.now()}`,
    content: optimizedPrompt,
    description: 'Auto-generated by learning engine prompt optimizer',
    variables: [],
  });

  if (result.ok) {
    logger.info({ workspaceId, agentId, promptId: result.value.id }, 'Optimized prompt created');
  } else {
    logger.warn({ workspaceId, agentId, error: result.error.message }, 'Failed to save optimized prompt');
  }
}
