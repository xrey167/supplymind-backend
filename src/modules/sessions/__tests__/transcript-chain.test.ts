import { describe, it, expect } from 'bun:test';
import { TranscriptChain } from '../transcript-chain';

describe('TranscriptChain', () => {
  it('appends messages with auto-generated IDs', () => {
    const chain = new TranscriptChain('session-1');
    const id = chain.append({ role: 'user', content: 'hello' });
    expect(typeof id).toBe('string');
    expect(chain.messages()).toHaveLength(1);
  });

  it('sets parentMessageId on subsequent messages', () => {
    const chain = new TranscriptChain('session-1');
    const id1 = chain.append({ role: 'user', content: 'first' });
    chain.append({ role: 'assistant', content: 'second' });
    expect(chain.messages()[1].parentMessageId).toBe(id1);
  });

  it('fork creates a new chain from a checkpoint', () => {
    const chain = new TranscriptChain('session-1');
    const id1 = chain.append({ role: 'user', content: 'first' });
    chain.append({ role: 'assistant', content: 'second' });

    const forked = chain.forkFrom(id1, 'session-2');
    expect(forked.sessionId).toBe('session-2');
    expect(forked.messages()).toHaveLength(1);
    expect(forked.messages()[0].content).toBe('first');
  });

  it('fork is independent of original', () => {
    const chain = new TranscriptChain('session-1');
    const id1 = chain.append({ role: 'user', content: 'first' });

    const forked = chain.forkFrom(id1, 'session-2');
    forked.append({ role: 'assistant', content: 'forked reply' });

    expect(chain.messages()).toHaveLength(1);
    expect(forked.messages()).toHaveLength(2);
  });

  it('serialize/deserialize round-trips correctly', () => {
    const chain = new TranscriptChain('session-1');
    chain.append({ role: 'user', content: 'hello' });
    chain.append({ role: 'assistant', content: 'world' });

    const serialized = chain.serialize();
    const restored = TranscriptChain.deserialize(serialized);
    expect(restored.messages()).toHaveLength(2);
    expect(restored.sessionId).toBe('session-1');
  });

  it('throws when forking from unknown message ID', () => {
    const chain = new TranscriptChain('session-1');
    expect(() => chain.forkFrom('nonexistent', 'session-2')).toThrow('not found');
  });
});
