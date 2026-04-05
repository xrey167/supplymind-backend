import { describe, it, expect } from 'bun:test';
import { QueryGuard } from '../query-guard';

describe('QueryGuard', () => {
  it('starts idle', () => {
    const guard = new QueryGuard();
    expect(guard.isActive).toBe(false);
    expect(guard.currentState).toBe('idle');
  });

  it('reserve transitions to dispatching', () => {
    const guard = new QueryGuard();
    expect(guard.reserve()).toBe(true);
    expect(guard.currentState).toBe('dispatching');
  });

  it('reserve fails when already active', () => {
    const guard = new QueryGuard();
    guard.reserve();
    expect(guard.reserve()).toBe(false);
  });

  it('tryStart transitions to running and returns generation', () => {
    const guard = new QueryGuard();
    guard.reserve();
    const gen = guard.tryStart();
    expect(gen).toBe(1);
    expect(guard.currentState).toBe('running');
  });

  it('tryStart returns null when not dispatching', () => {
    const guard = new QueryGuard();
    expect(guard.tryStart()).toBeNull();
  });

  it('end with correct generation returns to idle', () => {
    const guard = new QueryGuard();
    guard.reserve();
    const gen = guard.tryStart()!;
    expect(guard.end(gen)).toBe(true);
    expect(guard.currentState).toBe('idle');
  });

  it('end with stale generation returns false', () => {
    const guard = new QueryGuard();
    guard.reserve();
    const gen = guard.tryStart()!;
    guard.forceEnd();
    expect(guard.end(gen)).toBe(false);
  });

  it('forceEnd resets to idle and increments generation', () => {
    const guard = new QueryGuard();
    guard.reserve();
    guard.tryStart();
    const genBefore = guard.currentGeneration;
    guard.forceEnd();
    expect(guard.currentState).toBe('idle');
    expect(guard.currentGeneration).toBe(genBefore + 1);
  });
});
