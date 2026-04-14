import type { MissionRun, MissionPlan, WorkerSpec } from './missions.types';

/**
 * Compiles a mission into an execution plan (pure function, no IO).
 * Determines plan kind and which workers to spin up based on mode.
 */
export function compileMission(mission: Pick<MissionRun, 'mode' | 'disciplineMaxRetries'>): MissionPlan {
  switch (mission.mode) {
    case 'assist':
      return {
        kind: 'task',
        workers: [{ role: 'executor' }],
      };

    case 'interview':
      return {
        kind: 'task',
        workers: [{ role: 'planner' }],
      };

    case 'advisor': {
      const workers: WorkerSpec[] = [
        { role: 'researcher', phase: 'research' },
        { role: 'reviewer', phase: 'review' },
        { role: 'deep', phase: 'deep-analysis' },
      ];
      return { kind: 'collaboration', workers };
    }

    case 'team': {
      const workers: WorkerSpec[] = [
        { role: 'planner', phase: 'plan' },
        { role: 'executor', phase: 'execute' },
        { role: 'reviewer', phase: 'review' },
      ];
      return { kind: 'orchestration', workers };
    }

    case 'autopilot': {
      const workers: WorkerSpec[] = [
        { role: 'planner', phase: 'plan' },
        { role: 'executor', phase: 'execute' },
      ];
      return { kind: 'orchestration', workers };
    }

    case 'discipline': {
      const retries = mission.disciplineMaxRetries ?? 3;
      const workers: WorkerSpec[] = [{ role: 'executor', phase: 'execute' }];
      for (let i = 0; i < retries; i++) {
        workers.push({ role: 'reviewer', phase: `verify-${i + 1}` });
      }
      return { kind: 'orchestration', workers };
    }
  }
}
