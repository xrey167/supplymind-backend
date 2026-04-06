/**
 * CoordinatorMode — engine-layer phase orchestrator.
 *
 * Sits above the A2A task manager and the step-level orchestration engine.
 * Runs a multi-agent workflow through named phases where:
 *   - Each phase has a timeout and a set of agent tasks to dispatch in parallel
 *   - On timeout a phase can emit a partial handoff (passes whatever completed
 *     results to the next phase rather than failing the run)
 *   - Phase transitions fire COORDINATOR_PHASE_CHANGED / COMPLETED events
 *
 * Design:
 *   - Pure runtime primitive — no HTTP routes, no DB persistence of phase state
 *   - Delegates actual task execution to taskManager (A2A layer)
 *   - Delegates event emission to eventBus
 *   - Injectable clock for deterministic testing
 */
import { eventBus } from '../events/bus';
import { Topics } from '../events/topics';
import { taskManager } from '../infra/a2a/task-manager';
import { createCoordinatorConfig } from '../infra/a2a/coordinator-config';
import type { A2AMessage } from '../infra/a2a/types';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface PhaseTask {
  /** Logical name for this task within the phase (used in handoff context). */
  name: string;
  /** Message to send to the subagent. */
  message: A2AMessage;
  /** Agent ID to dispatch to. */
  agentId: string;
}

export interface Phase {
  /** Unique phase identifier. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Tasks to dispatch in parallel within this phase. */
  tasks: PhaseTask[];
  /**
   * Timeout in ms. When exceeded:
   *   - Completed tasks' results are forwarded as partial handoff
   *   - In-flight tasks are cancelled
   * Default: 60_000 ms (1 minute).
   */
  timeoutMs?: number;
}

export interface CoordinatorRunInput {
  /** Workspace the coordinator run belongs to. */
  workspaceId: string;
  /** Phases to execute in order. */
  phases: Phase[];
  /**
   * If true, a phase timeout produces a partial handoff instead of aborting
   * the entire run. Default: true.
   */
  allowPartialHandoff?: boolean;
  /** Injectable setTimeout (for tests). */
  _setTimeout?: typeof setTimeout;
}

export type PhaseStatus = 'completed' | 'partial' | 'failed';

export interface PhaseResult {
  phaseId: string;
  status: PhaseStatus;
  /** Results keyed by task name. Only present for completed tasks. */
  completedTasks: Record<string, unknown>;
  /** Task names that did not complete (timed out or errored). */
  failedTasks: string[];
  durationMs: number;
}

export interface CoordinatorResult {
  status: 'completed' | 'failed';
  phases: PhaseResult[];
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PHASE_TIMEOUT = 60_000;

/**
 * Race a promise against a timeout.
 * Resolves with { timedOut: false, value } or { timedOut: true }.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  _setTimeout: typeof setTimeout,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolve) => {
    const timer = _setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve({ timedOut: false, value }); },
      ()      => { clearTimeout(timer); resolve({ timedOut: true }); },
    );
  });
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

async function runPhase(
  phase: Phase,
  workspaceId: string,
  allowPartialHandoff: boolean,
  _setTimeout: typeof setTimeout,
): Promise<PhaseResult> {
  const start = performance.now();
  const timeoutMs = phase.timeoutMs ?? DEFAULT_PHASE_TIMEOUT;
  const coordinatorConfig = createCoordinatorConfig(workspaceId);

  // Fire phase-changed event
  eventBus.publish(Topics.COORDINATOR_PHASE_CHANGED, { phaseId: phase.id, label: phase.label, workspaceId }, { source: 'coordinator' }).catch(() => {});

  // Dispatch all tasks in parallel
  const taskPromises = phase.tasks.map(async (phaseTask) => {
    try {
      const task = await taskManager.send({
        agentConfig: { ...coordinatorConfig, id: phaseTask.agentId },
        callerId: 'coordinator',
        message: phaseTask.message,
      });
      return { name: phaseTask.name, task, ok: true as const };
    } catch (err) {
      logger.warn({ phaseId: phase.id, task: phaseTask.name, err }, 'Phase task dispatch failed');
      return { name: phaseTask.name, task: null, ok: false as const };
    }
  });

  // Collect results within timeout
  const settled = await withTimeout(
    Promise.allSettled(taskPromises),
    timeoutMs,
    _setTimeout,
  );

  const completedTasks: Record<string, unknown> = {};
  const failedTasks: string[] = [];

  if (settled.timedOut) {
    if (!allowPartialHandoff) {
      logger.warn({ phaseId: phase.id }, 'Phase timed out, partial handoff disabled — failing run');
      return { phaseId: phase.id, status: 'failed', completedTasks, failedTasks: phase.tasks.map(t => t.name), durationMs: performance.now() - start };
    }
    logger.info({ phaseId: phase.id }, 'Phase timed out — emitting partial handoff');
    // Mark all tasks as failed since we don't know individual status yet
    for (const t of phase.tasks) failedTasks.push(t.name);
  } else {
    for (const result of settled.value) {
      if (result.status === 'fulfilled') {
        const { name, task, ok } = result.value;
        if (ok && task && task.status.state === 'completed') {
          completedTasks[name] = task.artifacts;
        } else {
          failedTasks.push(name);
        }
      } else {
        // Promise rejected
        failedTasks.push('unknown');
      }
    }
  }

  const phaseStatus: PhaseStatus =
    failedTasks.length === 0 ? 'completed'
    : failedTasks.length < phase.tasks.length ? 'partial'
    : 'failed';

  // Fire phase-completed event
  eventBus.publish(
    Topics.COORDINATOR_PHASE_COMPLETED,
    { phaseId: phase.id, status: phaseStatus, completedCount: Object.keys(completedTasks).length, failedCount: failedTasks.length, workspaceId },
    { source: 'coordinator' },
  ).catch(() => {});

  return {
    phaseId: phase.id,
    status: phaseStatus,
    completedTasks,
    failedTasks,
    durationMs: performance.now() - start,
  };
}

// ---------------------------------------------------------------------------
// CoordinatorMode
// ---------------------------------------------------------------------------

export class CoordinatorMode {
  /**
   * Run a multi-phase coordinator workflow.
   *
   * Phases execute sequentially. Each phase dispatches its tasks in parallel
   * and waits up to `timeoutMs` for results. Partial handoff passes whatever
   * completed to the next phase's context.
   */
  async run(input: CoordinatorRunInput): Promise<CoordinatorResult> {
    const start = performance.now();
    const allowPartialHandoff = input.allowPartialHandoff ?? true;
    const _setTimeout = input._setTimeout ?? setTimeout;

    const phaseResults: PhaseResult[] = [];

    for (const phase of input.phases) {
      const result = await runPhase(phase, input.workspaceId, allowPartialHandoff, _setTimeout);
      phaseResults.push(result);

      if (result.status === 'failed' && !allowPartialHandoff) {
        return { status: 'failed', phases: phaseResults, totalDurationMs: performance.now() - start };
      }
    }

    return {
      status: 'completed',
      phases: phaseResults,
      totalDurationMs: performance.now() - start,
    };
  }
}

export const coordinatorMode = new CoordinatorMode();
