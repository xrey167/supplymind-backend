import { execute } from '../../core/gateway/gateway';
import { missionsRepo } from '../../modules/missions/missions.repo';
import { agentsRepo } from '../../modules/agents/agents.repo';
import { agentProfilesService } from '../../modules/agent-profiles/agent-profiles.service';
import { coordinatorMode } from '../../engine/coordinator';
import { eventBus } from '../../events/bus';
import { logger } from '../../config/logger';
import { MissionTopics } from './topics';
import type { MissionRun, MissionWorker, MissionPlan } from '../../modules/missions/missions.types';
import type { GatewayContext } from '../../core/gateway/gateway.types';
import type { Phase, PhaseTask } from '../../engine/coordinator';
import type { A2AMessage } from '../../engine/a2a/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGatewayContext(run: MissionRun): GatewayContext {
  return {
    workspaceId: run.workspaceId,
    callerId: `mission:${run.id}`,
    callerRole: 'system',
  };
}

function buildWorkerMessage(run: MissionRun, worker: MissionWorker, systemPrompt?: string | null): string {
  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);
  const inputSummary = JSON.stringify(run.input ?? {});
  parts.push(`Mission: ${run.name}. Mode: ${run.mode}. Role: ${worker.role}.`);
  if (inputSummary !== '{}') parts.push(`Input: ${inputSummary}`);
  return parts.join('\n');
}

/** Returns the best agentConfig.id for a given worker, or null if none found. */
async function resolveAgentId(
  workspaceId: string,
  worker: MissionWorker,
): Promise<string | null> {
  const profile = await agentProfilesService.resolveForCategory(workspaceId, worker.role);

  const agents = await agentsRepo.findByWorkspace(workspaceId);
  if (agents.length === 0) return null;

  // Prefer an agent whose model matches the profile's model preference.
  if (profile?.model) {
    const match = agents.find((a) => a.model === profile.model);
    if (match) return match.id;
  }

  return agents[0]!.id;
}

// ---------------------------------------------------------------------------
// Budget gate — checks before dispatching each worker
// ---------------------------------------------------------------------------

async function checkBudget(run: MissionRun): Promise<boolean> {
  if (run.budgetCents == null) return true; // no budget set — always allow
  const fresh = await missionsRepo.findRunById(run.id);
  if (!fresh) return false;
  if (fresh.spentCents >= fresh.budgetCents!) {
    await eventBus.publish(MissionTopics.MISSION_BUDGET_EXCEEDED, {
      workspaceId: run.workspaceId,
      missionRunId: run.id,
      budgetCents: fresh.budgetCents,
      spentCents: fresh.spentCents,
    });
    await missionsRepo.updateRunStatus(run.id, 'paused');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

async function dispatchWorker(
  run: MissionRun,
  worker: MissionWorker,
  agentId: string,
  systemPrompt?: string | null,
): Promise<void> {
  await missionsRepo.updateWorkerStatus(worker.id, 'running');
  eventBus.publish(MissionTopics.MISSION_WORKER_STARTED, {
    workspaceId: run.workspaceId,
    missionRunId: run.id,
    workerId: worker.id,
    role: worker.role,
  }).catch((err: unknown) => logger.error({ err, topic: MissionTopics.MISSION_WORKER_STARTED, workerId: worker.id }, 'event publish failed'));

  try {
    const message = buildWorkerMessage(run, worker, systemPrompt);
    const result = await execute({
      op: 'task.send',
      params: { agentId, message, runMode: 'background' },
      context: buildGatewayContext(run),
    });

    if (result.ok && typeof result.value === 'object' && result.value !== null && 'taskId' in result.value) {
      // Background dispatch — task ID recorded; worker stays running until task.completed event
    }

    await missionsRepo.updateWorkerStatus(worker.id, 'completed');
    eventBus.publish(MissionTopics.MISSION_WORKER_COMPLETED, {
      workspaceId: run.workspaceId,
      missionRunId: run.id,
      workerId: worker.id,
      role: worker.role,
    }).catch((err: unknown) => logger.error({ err, topic: MissionTopics.MISSION_WORKER_COMPLETED, workerId: worker.id }, 'event publish failed'));
  } catch (err) {
    await missionsRepo.updateWorkerStatus(worker.id, 'failed');
    eventBus.publish(MissionTopics.MISSION_WORKER_FAILED, {
      workspaceId: run.workspaceId,
      missionRunId: run.id,
      workerId: worker.id,
      role: worker.role,
      error: err instanceof Error ? err.message : String(err),
    }).catch((publishErr: unknown) => logger.error({ err: publishErr, topic: MissionTopics.MISSION_WORKER_FAILED, workerId: worker.id }, 'event publish failed'));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function executeMission(
  run: MissionRun,
  plan: MissionPlan,
  workers: MissionWorker[],
): Promise<void> {
  if (workers.length === 0) {
    logger.warn({ missionRunId: run.id }, 'executeMission: no workers to dispatch');
    await missionsRepo.updateRunStatus(run.id, 'completed');
    return;
  }

  switch (plan.kind) {
    case 'task': {
      const worker = workers[0]!;
      if (!(await checkBudget(run))) return;

      const agentId = await resolveAgentId(run.workspaceId, worker);
      if (!agentId) {
        logger.error({ missionRunId: run.id, role: worker.role }, 'executeMission: no agent found for worker');
        await missionsRepo.updateRunStatus(run.id, 'failed');
        return;
      }

      const profile = await agentProfilesService.resolveForCategory(run.workspaceId, worker.role);
      await dispatchWorker(run, worker, agentId, profile?.systemPrompt);
      await missionsRepo.updateRunStatus(run.id, 'completed');
      break;
    }

    case 'collaboration': {
      // Single pre-flight check for the entire batch — avoids N concurrent reads
      // all passing before any cost is recorded.
      if (!(await checkBudget(run))) return;
      const results = await Promise.allSettled(
        workers.map(async (worker) => {
          const agentId = await resolveAgentId(run.workspaceId, worker);
          if (!agentId) {
            logger.error({ missionRunId: run.id, role: worker.role }, 'executeMission: no agent for worker');
            await missionsRepo.updateWorkerStatus(worker.id, 'failed');
            return;
          }
          const profile = await agentProfilesService.resolveForCategory(run.workspaceId, worker.role);
          await dispatchWorker(run, worker, agentId, profile?.systemPrompt);
        }),
      );

      const anyFailed = results.some((r) => r.status === 'rejected');
      await missionsRepo.updateRunStatus(run.id, anyFailed ? 'failed' : 'completed');
      break;
    }

    case 'orchestration': {
      // Group workers by phase, preserving order
      const phaseGroups = new Map<string, MissionWorker[]>();
      for (const worker of workers) {
        const key = worker.phase ?? 'default';
        if (!phaseGroups.has(key)) phaseGroups.set(key, []);
        phaseGroups.get(key)!.push(worker);
      }

      const phases: Phase[] = await Promise.all(
        [...phaseGroups.entries()].map(async ([phaseKey, phaseWorkers], idx) => {
          const tasks: PhaseTask[] = await Promise.all(
            phaseWorkers.map(async (worker) => {
              const agentId = await resolveAgentId(run.workspaceId, worker);
              if (!agentId) throw new Error(`No agent for worker role ${worker.role}`);
              const profile = await agentProfilesService.resolveForCategory(run.workspaceId, worker.role);
              const message = buildWorkerMessage(run, worker, profile?.systemPrompt);
              const a2aMsg: A2AMessage = { role: 'user', parts: [{ kind: 'text', text: message }] };
              return {
                name: `${worker.role}-${worker.id}`,
                message: a2aMsg,
                agentId,
              } satisfies PhaseTask;
            }),
          );
          return {
            id: `phase-${idx}-${phaseKey}`,
            label: phaseKey,
            tasks,
          } satisfies Phase;
        }),
      );

      // Run phases one-by-one so budget can be re-checked between phases.
      for (const phase of phases) {
        if (!(await checkBudget(run))) return;
        await coordinatorMode.run({ workspaceId: run.workspaceId, phases: [phase] });
      }
      await missionsRepo.updateRunStatus(run.id, 'completed');
      break;
    }

    default: {
      logger.error({ missionRunId: run.id, kind: (plan as any).kind }, 'executeMission: unknown plan kind');
      await missionsRepo.updateRunStatus(run.id, 'failed');
    }
  }
}
