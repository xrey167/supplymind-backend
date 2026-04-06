import { describe, it, expect, beforeEach } from 'bun:test';
import { SequencedEventBuffer } from '../sse-sequence';

interface TestEvent {
  type: string;
  data: string;
}

describe('SequencedEventBuffer', () => {
  let buffer: SequencedEventBuffer<TestEvent>;

  beforeEach(() => {
    buffer = new SequencedEventBuffer({ maxBufferSize: 5 });
  });

  it('assigns incrementing sequence numbers', () => {
    const s1 = buffer.push({ type: 'text', data: 'hello' });
    const s2 = buffer.push({ type: 'text', data: 'world' });
    expect(s2).toBe(s1 + 1);
  });

  it('catchUp returns events after fromSeq', () => {
    buffer.push({ type: 'a', data: '1' });
    buffer.push({ type: 'b', data: '2' });
    buffer.push({ type: 'c', data: '3' });
    const missed = buffer.catchUp(1);
    expect(missed.length).toBe(2);
    expect(missed[0].event.type).toBe('b');
    expect(missed[1].event.type).toBe('c');
  });

  it('catchUp with seq=0 returns all events', () => {
    buffer.push({ type: 'x', data: '1' });
    buffer.push({ type: 'y', data: '2' });
    const all = buffer.catchUp(0);
    expect(all.length).toBe(2);
  });

  it('evicts oldest events when buffer is full', () => {
    for (let i = 0; i < 6; i++) buffer.push({ type: 'e', data: String(i) });
    // maxBufferSize=5, so first event evicted
    const all = buffer.catchUp(0);
    expect(all.length).toBe(5);
  });

  it('catchUp beyond current seq returns empty', () => {
    buffer.push({ type: 'a', data: '1' });
    const missed = buffer.catchUp(999);
    expect(missed.length).toBe(0);
  });

  it('returns sequence number from push', () => {
    const seq = buffer.push({ type: 'z', data: 'test' });
    expect(typeof seq).toBe('number');
    expect(seq).toBeGreaterThan(0);
  });
});
