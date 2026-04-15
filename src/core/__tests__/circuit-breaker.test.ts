import { describe, it, expect } from 'bun:test';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker';

function succeed(): Promise<string> {
  return Promise.resolve('ok');
}

function fail(): Promise<never> {
  return Promise.reject(new Error('service down'));
}

describe('CircuitBreaker', () => {
  describe('CLOSED state (normal)', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, timeout: 1000 });
      expect(cb.getState()).toBe('CLOSED');
    });

    it('passes through successful calls', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, timeout: 1000 });
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('counts failures without opening below threshold', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, timeout: 1000 });
      for (let i = 0; i < 2; i++) {
        await cb.execute(fail).catch(() => {});
      }
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getMetrics().failureCount).toBe(2);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('opens after failureThreshold consecutive failures', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, timeout: 5000 });
      for (let i = 0; i < 3; i++) {
        await cb.execute(fail).catch(() => {});
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('resets failure count on success', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, timeout: 5000 });
      await cb.execute(fail).catch(() => {});
      await cb.execute(fail).catch(() => {});
      await cb.execute(succeed); // resets failure count
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getMetrics().failureCount).toBe(0);
    });
  });

  describe('OPEN state (fast-fail)', () => {
    it('throws CircuitOpenError without calling fn', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, timeout: 60_000 });
      await cb.execute(fail).catch(() => {});
      expect(cb.getState()).toBe('OPEN');

      let fnCalled = false;
      await expect(
        cb.execute(() => { fnCalled = true; return Promise.resolve('x'); }),
      ).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fnCalled).toBe(false);
    });

    it('tracks rejectedCount', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, timeout: 60_000 });
      await cb.execute(fail).catch(() => {});
      for (let i = 0; i < 3; i++) {
        await cb.execute(succeed).catch(() => {});
      }
      expect(cb.getMetrics().rejectedCount).toBe(3);
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after timeout elapses', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, timeout: 1 });
      await cb.execute(fail).catch(() => {});
      expect(cb.getState()).toBe('OPEN');
      // Wait for timeout
      await new Promise((r) => setTimeout(r, 10));
      // getState() triggers the lazy OPEN→HALF_OPEN check
      expect(cb.getState()).toBe('HALF_OPEN');
    });
  });

  describe('HALF_OPEN state (probe)', () => {
    async function openThenWait(successThreshold = 2): Promise<CircuitBreaker> {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, successThreshold, timeout: 1 });
      await cb.execute(fail).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
      cb.getState(); // trigger transition
      return cb;
    }

    it('closes after successThreshold successes in HALF_OPEN', async () => {
      const cb = await openThenWait(2);
      await cb.execute(succeed);
      await cb.execute(succeed);
      expect(cb.getState()).toBe('CLOSED');
    });

    it('reopens on failure in HALF_OPEN', async () => {
      // Use a longer re-open timeout so getState() in the assertion
      // cannot immediately re-transition from OPEN → HALF_OPEN.
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, successThreshold: 2, timeout: 50 });
      await cb.execute(fail).catch(() => {});   // CLOSED → OPEN
      await new Promise((r) => setTimeout(r, 60)); // wait for 50ms timeout to elapse
      cb.getState();                             // OPEN → HALF_OPEN
      await cb.execute(fail).catch(() => {});   // HALF_OPEN → OPEN (re-open timeout resets to 50ms)
      expect(cb.getState()).toBe('OPEN');        // safe: 50ms window won't expire in assertion
    });
  });

  describe('getMetrics', () => {
    it('returns name, state, counts, and lastFailureAt', async () => {
      const cb = new CircuitBreaker({ name: 'svc-x', failureThreshold: 5, timeout: 5000 });
      await cb.execute(fail).catch(() => {});
      const m = cb.getMetrics();
      expect(m.name).toBe('svc-x');
      expect(m.state).toBe('CLOSED');
      expect(m.failureCount).toBe(1);
      expect(m.successCount).toBe(0);
      expect(m.rejectedCount).toBe(0);
      expect(m.lastFailureAt).toBeInstanceOf(Date);
    });
  });
});
