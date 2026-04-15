import { describe, it, expect } from 'bun:test';
import { compileMission } from '../missions.compiler';

describe('compileMission', () => {
  it('assist → task with single executor worker', () => {
    const plan = compileMission({ mode: 'assist', disciplineMaxRetries: 3 });
    expect(plan.kind).toBe('task');
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0]!.role).toBe('executor');
  });

  it('interview → task with single planner worker', () => {
    const plan = compileMission({ mode: 'interview', disciplineMaxRetries: 3 });
    expect(plan.kind).toBe('task');
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0]!.role).toBe('planner');
  });

  it('advisor → collaboration with 3 workers (researcher, reviewer, deep)', () => {
    const plan = compileMission({ mode: 'advisor', disciplineMaxRetries: 3 });
    expect(plan.kind).toBe('collaboration');
    expect(plan.workers).toHaveLength(3);
    expect(plan.workers.map(w => w.role)).toEqual(['researcher', 'reviewer', 'deep']);
  });

  it('team → orchestration with 3 phases (plan/execute/review)', () => {
    const plan = compileMission({ mode: 'team', disciplineMaxRetries: 3 });
    expect(plan.kind).toBe('orchestration');
    expect(plan.workers).toHaveLength(3);
    expect(plan.workers[0]!.phase).toBe('plan');
    expect(plan.workers[1]!.phase).toBe('execute');
    expect(plan.workers[2]!.phase).toBe('review');
  });

  it('autopilot → orchestration with 2 phases (plan/execute)', () => {
    const plan = compileMission({ mode: 'autopilot', disciplineMaxRetries: 3 });
    expect(plan.kind).toBe('orchestration');
    expect(plan.workers).toHaveLength(2);
    expect(plan.workers.map(w => w.phase)).toEqual(['plan', 'execute']);
  });

  it('discipline → orchestration with execute + N verify-fix phases', () => {
    const plan = compileMission({ mode: 'discipline', disciplineMaxRetries: 2 });
    expect(plan.kind).toBe('orchestration');
    // 1 execute + 2 verify workers
    expect(plan.workers).toHaveLength(3);
    expect(plan.workers[0]!.phase).toBe('execute');
    expect(plan.workers[1]!.phase).toBe('verify-1');
    expect(plan.workers[2]!.phase).toBe('verify-2');
  });
});
