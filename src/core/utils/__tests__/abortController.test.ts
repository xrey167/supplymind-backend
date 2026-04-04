import { describe, expect, it } from 'bun:test';
import { combinedAbortSignal, createChildAbortController } from '../abortController';

describe('createChildAbortController', () => {
  it('aborting the parent aborts the child', () => {
    const parent = new AbortController();
    const child = createChildAbortController(parent);

    expect(child.signal.aborted).toBe(false);
    parent.abort('parent-reason');
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe('parent-reason');
  });

  it('aborting the child does NOT abort the parent', () => {
    const parent = new AbortController();
    const child = createChildAbortController(parent);

    child.abort('child-reason');
    expect(child.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it('if parent is already aborted, child is immediately aborted', () => {
    const parent = new AbortController();
    parent.abort('pre-aborted');
    const child = createChildAbortController(parent);

    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe('pre-aborted');
  });

  it('child abort removes the parent listener — parent abort does not double-fire', () => {
    const parent = new AbortController();
    const child = createChildAbortController(parent);

    // Abort the child independently first
    child.abort('self');
    expect(child.signal.aborted).toBe(true);

    // Now abort the parent — child was already aborted, no errors should occur
    parent.abort('late');
    // child reason should still be 'self' (not overwritten), because it was already aborted
    expect(child.signal.reason).toBe('self');
    expect(parent.signal.aborted).toBe(true);
  });
});

describe('combinedAbortSignal', () => {
  it('fires when the first input signal aborts', () => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const combined = combinedAbortSignal([ac1.signal, ac2.signal]);

    expect(combined.aborted).toBe(false);
    ac1.abort('first');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('first');
  });

  it('fires when the second of two signals aborts (first not fired)', () => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const combined = combinedAbortSignal([ac1.signal, ac2.signal]);

    expect(combined.aborted).toBe(false);
    ac2.abort('second');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('second');
  });

  it('if any input is already aborted, returned signal is immediately aborted', () => {
    const ac1 = new AbortController();
    ac1.abort('already');
    const ac2 = new AbortController();
    const combined = combinedAbortSignal([ac1.signal, ac2.signal]);

    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('already');
  });

  it('fires after timeout elapses', async () => {
    const ac = new AbortController();
    const combined = combinedAbortSignal([ac.signal], 50);

    expect(combined.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(combined.aborted).toBe(true);
    // AbortSignal.timeout() fires with a runtime-defined reason; just verify it fired
    expect(combined.reason).toBeDefined();
  });

  it('combinedAbortSignal: removes listeners from non-fired signals after first fires', () => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    let fireCount = 0;
    const combined = combinedAbortSignal([ac1.signal, ac2.signal]);
    combined.addEventListener('abort', () => fireCount++);
    ac1.abort('first');
    ac2.abort('second');  // cleanup should have removed ac2's listener
    expect(fireCount).toBe(1);
  });

  it('does NOT fire before timeout if signals are not aborted', async () => {
    const ac = new AbortController();
    const combined = combinedAbortSignal([ac.signal], 200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(combined.aborted).toBe(false);

    // cleanup — abort the controller so the timer is cleared
    ac.abort('cleanup');
  });
});
