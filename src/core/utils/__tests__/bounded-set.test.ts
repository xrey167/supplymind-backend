import { describe, it, expect } from 'bun:test';
import { BoundedSet } from '../bounded-set';

describe('BoundedSet', () => {
  it('stores and checks items', () => {
    const set = new BoundedSet(10);
    set.add('a');
    set.add('b');
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(false);
  });

  it('evicts oldest when at capacity', () => {
    const set = new BoundedSet(3);
    set.add('a');
    set.add('b');
    set.add('c');
    // At capacity — adding 'd' should evict 'a'
    set.add('d');
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
    expect(set.has('d')).toBe(true);
  });

  it('does not duplicate on re-add', () => {
    const set = new BoundedSet(3);
    set.add('a');
    set.add('b');
    set.add('a'); // re-add, should not advance write pointer
    set.add('c');
    // 'a' should still be there — no eviction happened for it
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('clear removes all items', () => {
    const set = new BoundedSet(5);
    set.add('a');
    set.add('b');
    set.clear();
    expect(set.has('a')).toBe(false);
    expect(set.size).toBe(0);
  });

  it('wraps around the ring buffer correctly', () => {
    const set = new BoundedSet(2);
    set.add('a'); // ring[0]
    set.add('b'); // ring[1]
    set.add('c'); // ring[0] — evicts 'a'
    set.add('d'); // ring[1] — evicts 'b'
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(false);
    expect(set.has('c')).toBe(true);
    expect(set.has('d')).toBe(true);
  });

  it('size tracks correctly', () => {
    const set = new BoundedSet(3);
    expect(set.size).toBe(0);
    set.add('a');
    expect(set.size).toBe(1);
    set.add('b');
    set.add('c');
    expect(set.size).toBe(3);
    set.add('d'); // evicts 'a'
    expect(set.size).toBe(3);
  });
});
