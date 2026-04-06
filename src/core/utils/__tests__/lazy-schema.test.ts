import { describe, it, expect } from 'bun:test';
import { lazySchema } from '../lazy-schema';
import { z } from 'zod';

describe('lazySchema', () => {
  it('calls factory only once across multiple invocations', () => {
    let calls = 0;
    const schema = lazySchema(() => { calls++; return z.object({ x: z.string() }); });
    schema(); schema(); schema();
    expect(calls).toBe(1);
  });

  it('returns the same schema instance every call', () => {
    const schema = lazySchema(() => z.string());
    expect(schema()).toBe(schema());
  });

  it('schema validates correctly', () => {
    const schema = lazySchema(() => z.object({ name: z.string() }));
    expect(schema().parse({ name: 'test' })).toEqual({ name: 'test' });
  });
});
