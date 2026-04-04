import { describe, test, expect, beforeEach } from 'bun:test';
import { JsonRpcDispatcher } from '../jsonrpc';

describe('JsonRpcDispatcher', () => {
  let dispatcher: JsonRpcDispatcher;

  beforeEach(() => {
    dispatcher = new JsonRpcDispatcher();
  });

  test('dispatches to registered method', async () => {
    dispatcher.register('echo', async (params) => params);
    const res = await dispatcher.dispatch({ jsonrpc: '2.0', id: '1', method: 'echo', params: { msg: 'hi' } });
    expect(res).toEqual({ jsonrpc: '2.0', id: '1', result: { msg: 'hi' } });
  });

  test('returns method not found for unknown method', async () => {
    const res = await dispatcher.dispatch({ jsonrpc: '2.0', id: '2', method: 'nope', params: {} });
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toContain('nope');
  });

  test('returns error when handler throws', async () => {
    dispatcher.register('fail', async () => { throw new Error('boom'); });
    const res = await dispatcher.dispatch({ jsonrpc: '2.0', id: '3', method: 'fail', params: {} });
    expect(res.error?.code).toBe(-32000);
    expect(res.error?.message).toBe('boom');
  });

  test('preserves request id in response', async () => {
    dispatcher.register('ok', async () => 'fine');
    const res = await dispatcher.dispatch({ jsonrpc: '2.0', id: 'abc-123', method: 'ok', params: {} });
    expect(res.id).toBe('abc-123');
  });
});
