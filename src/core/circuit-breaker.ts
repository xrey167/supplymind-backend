export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Unique name — used for metrics and registry lookup. */
  name: string;
  /** Number of consecutive failures before opening. Default: 5. */
  failureThreshold?: number;
  /** Number of consecutive successes in HALF_OPEN before closing. Default: 2. */
  successThreshold?: number;
  /** Milliseconds to wait in OPEN before probing (HALF_OPEN). Default: 30_000. */
  timeout?: number;
}

export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  rejectedCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
}

/** Thrown when a call is rejected because the circuit is open. */
export class CircuitOpenError extends Error {
  readonly circuitName: string;
  constructor(name: string) {
    super(`Circuit breaker OPEN: ${name} — call rejected to prevent cascading failure`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
  }
}

/**
 * 3-state circuit breaker for external service calls.
 *
 * States:
 *   CLOSED    — normal operation; failures increment counter
 *   OPEN      — fast-fail; all calls throw CircuitOpenError without invoking fn
 *   HALF_OPEN — probe mode; limited calls allowed to test recovery
 *
 * Transitions:
 *   CLOSED    → OPEN:      consecutive failures reach failureThreshold
 *   OPEN      → HALF_OPEN: timeout elapses (checked lazily on next getState())
 *   HALF_OPEN → CLOSED:    successThreshold consecutive successes
 *   HALF_OPEN → OPEN:      any failure
 *
 * Usage:
 *   const cb = circuitBreakerRegistry.get('erp-bc', { failureThreshold: 5, timeout: 30_000 });
 *   const result = await cb.execute(() => bcClient.getVendors());
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private rejectedCount = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private openedAt: number | null = null;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 2;
    this.timeout = opts.timeout ?? 30_000;
  }

  /**
   * Returns the current state, transitioning OPEN→HALF_OPEN if timeout elapsed.
   * Lazy: call before executing to get an accurate state.
   */
  getState(): CircuitState {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.timeout) {
        this.state = 'HALF_OPEN';
        this.consecutiveSuccesses = 0;
      }
    }
    return this.state;
  }

  /**
   * Wraps `fn` with circuit-breaker logic.
   * Throws `CircuitOpenError` immediately if the circuit is open.
   * Records success/failure and drives state transitions.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'OPEN') {
      this.rejectedCount++;
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.lastSuccessAt = new Date();
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.state = 'CLOSED';
        this.openedAt = null;
        this.consecutiveSuccesses = 0;
      }
    }
  }

  private onFailure(): void {
    this.lastFailureAt = new Date();
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      return;
    }

    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /** Returns a snapshot of current metrics. OTel-ready — poll via observable gauge. */
  getMetrics(): CircuitBreakerMetrics {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.consecutiveFailures,
      successCount: this.consecutiveSuccesses,
      rejectedCount: this.rejectedCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
}

/**
 * Registry for named circuit breakers.
 * Call `get(name, opts?)` to create-or-retrieve a breaker.
 * Options are only applied on first creation — subsequent calls return the cached instance.
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  get(name: string, opts?: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...opts }));
    }
    return this.breakers.get(name)!;
  }

  list(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  /** Remove a named breaker (e.g. for testing). */
  delete(name: string): boolean {
    return this.breakers.delete(name);
  }
}

/** Application-wide singleton registry. Use this in production code. */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
