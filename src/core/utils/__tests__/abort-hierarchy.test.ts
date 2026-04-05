import { describe, it, expect } from 'bun:test';
import { createChildAbortController, createAbortChain } from '../abort-hierarchy';

describe('createChildAbortController', () => {
  it('child aborts when parent aborts', () => {
    const parent = new AbortController();
    const child = createChildAbortController(parent);
    parent.abort('test reason');
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe('test reason');
  });

  it('child is already aborted if parent was aborted', () => {
    const parent = new AbortController();
    parent.abort('already');
    const child = createChildAbortController(parent);
    expect(child.signal.aborted).toBe(true);
  });

  it('aborting child does not abort parent', () => {
    const parent = new AbortController();
    const child = createChildAbortController(parent);
    child.abort();
    expect(parent.signal.aborted).toBe(false);
  });

  it('multiple children all abort with parent', () => {
    const parent = new AbortController();
    const c1 = createChildAbortController(parent);
    const c2 = createChildAbortController(parent);
    parent.abort();
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
  });
});

describe('createAbortChain', () => {
  it('creates chain of given depth', () => {
    const chain = createAbortChain(3);
    expect(chain).toHaveLength(3);
  });

  it('aborting root aborts all descendants', () => {
    const chain = createAbortChain(4);
    chain[0].abort('cascade');
    for (const c of chain) {
      expect(c.signal.aborted).toBe(true);
    }
  });

  it('aborting middle does not abort ancestors', () => {
    const chain = createAbortChain(3);
    chain[1].abort();
    expect(chain[0].signal.aborted).toBe(false);
    expect(chain[2].signal.aborted).toBe(true);
  });

  it('returns empty for depth 0', () => {
    expect(createAbortChain(0)).toHaveLength(0);
  });
});
