/**
 * QueryGuard — state machine preventing re-entrant async operations.
 *
 * Three states: idle → dispatching → running.
 * Uses generation numbers to detect stale completions.
 *
 * Use case: ensure only one LLM query or long-running operation
 * proceeds at a time per task/session, aborting stale ones.
 */

type State = 'idle' | 'dispatching' | 'running';

export class QueryGuard {
  private state: State = 'idle';
  private generation = 0;

  /** Try to reserve the guard for dispatch. Returns false if already active. */
  reserve(): boolean {
    if (this.state !== 'idle') return false;
    this.state = 'dispatching';
    return true;
  }

  /** Transition from dispatching to running. Returns generation number, or null if not dispatching. */
  tryStart(): number | null {
    if (this.state !== 'dispatching') return null;
    this.state = 'running';
    return ++this.generation;
  }

  /** End a running operation. Returns false if generation is stale. */
  end(gen: number): boolean {
    if (this.state !== 'running' || gen !== this.generation) return false;
    this.state = 'idle';
    return true;
  }

  /** Force back to idle (e.g., on error or abort). */
  forceEnd(): void {
    this.state = 'idle';
    this.generation++;
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  get currentState(): State {
    return this.state;
  }

  get currentGeneration(): number {
    return this.generation;
  }
}
