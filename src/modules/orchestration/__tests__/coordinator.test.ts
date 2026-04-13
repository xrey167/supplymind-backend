import { describe, it, expect } from 'bun:test';
import { Coordinator, type CoordinatorPhase } from '../coordinator';

describe('Coordinator', () => {
  it('starts in research phase', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    expect(coord.currentPhase()).toBe('research');
  });

  it('advances through all phases in order', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    const phases: CoordinatorPhase[] = [];
    while (coord.currentPhase() !== 'done') {
      phases.push(coord.currentPhase());
      coord.advance();
    }
    expect(phases).toEqual(['research', 'plan', 'implement', 'verify']);
  });

  it('stays in done after advance() called past the end', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    for (let i = 0; i < 10; i++) coord.advance();
    expect(coord.currentPhase()).toBe('done');
  });

  it('recordWorkerResult stores result under current phase', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    coord.recordWorkerResult('w1', { found: 'data' });
    coord.recordWorkerResult('w2', { found: 'more' });
    const results = coord.phaseResults('research');
    expect(results).toHaveLength(2);
    expect(results[0].workerId).toBe('w1');
    expect(results[1].workerId).toBe('w2');
  });

  it('phaseResults for a different phase returns empty', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    coord.recordWorkerResult('w1', { x: 1 });
    expect(coord.phaseResults('plan')).toHaveLength(0);
  });

  it('allResults returns every recorded result across phases', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    coord.recordWorkerResult('w1', 'a');
    coord.advance();
    coord.recordWorkerResult('w2', 'b');
    const all = coord.allResults();
    expect(all).toHaveLength(2);
    expect(all[0].phase).toBe('research');
    expect(all[1].phase).toBe('plan');
  });

  it('isDone returns false while phases remain', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    expect(coord.isDone()).toBe(false);
  });

  it('isDone returns true in done phase', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    while (!coord.isDone()) coord.advance();
    expect(coord.isDone()).toBe(true);
  });
});
