export type CoordinatorPhase = 'research' | 'plan' | 'implement' | 'verify' | 'done';

const PHASE_ORDER: CoordinatorPhase[] = ['research', 'plan', 'implement', 'verify', 'done'];

export interface WorkerResult {
  workerId: string;
  phase: CoordinatorPhase;
  result: unknown;
  completedAt: number;
}

export interface CoordinatorConfig {
  orchestrationId: string;
}

/**
 * Coordinator Mode — phase-based multi-agent orchestration.
 *
 * Phases (in order):
 *   research   — parallel read-only workers gather information
 *   plan       — coordinator synthesizes findings, creates an implementation plan
 *   implement  — serial workers execute plan steps
 *   verify     — adversarial verification workers check output quality
 *   done       — all phases complete
 *
 * Key constraint: the coordinator NEVER delegates synthesis.
 * It reads all worker results and forms its own understanding before
 * directing the next phase.
 *
 * Usage:
 *   const coord = new Coordinator({ orchestrationId: run.id });
 *   // dispatch research workers, collect results
 *   coord.recordWorkerResult('agent-1', researchResult);
 *   coord.advance(); // → 'plan'
 *   // synthesize plan from coord.phaseResults('research')
 *   coord.advance(); // → 'implement' ...
 */
export class Coordinator {
  readonly orchestrationId: string;
  private phase: CoordinatorPhase = 'research';
  private results: WorkerResult[] = [];

  constructor(config: CoordinatorConfig) {
    this.orchestrationId = config.orchestrationId;
  }

  /** Returns the current phase. */
  currentPhase(): CoordinatorPhase {
    return this.phase;
  }

  /** Returns true when all phases are complete. */
  isDone(): boolean {
    return this.phase === 'done';
  }

  /** Advances to the next phase. No-op if already done. */
  advance(): void {
    const idx = PHASE_ORDER.indexOf(this.phase);
    if (idx < PHASE_ORDER.length - 1) {
      this.phase = PHASE_ORDER[idx + 1];
    }
  }

  /** Records a worker's result for the current phase. */
  recordWorkerResult(workerId: string, result: unknown): void {
    this.results.push({
      workerId,
      phase: this.phase,
      result,
      completedAt: Date.now(),
    });
  }

  /** Returns all worker results recorded during the given phase. */
  phaseResults(phase: CoordinatorPhase): WorkerResult[] {
    return this.results.filter((r) => r.phase === phase);
  }

  /** Returns all worker results across all phases, in recording order. */
  allResults(): WorkerResult[] {
    return [...this.results];
  }
}
