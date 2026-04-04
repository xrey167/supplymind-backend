import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock global fetch before importing the module under test
// ---------------------------------------------------------------------------
const mockFetch = mock(async (_url: string, _opts?: RequestInit): Promise<Response> => {
  return new Response(JSON.stringify({}), { status: 200 });
});

// @ts-ignore – override global fetch in Bun
global.fetch = mockFetch;

import { workerRegistry } from '../worker-registry';
import type { AgentCard } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeAgentCard = (overrides: Partial<AgentCard> = {}): AgentCard => ({
  name: 'Test Agent',
  description: 'A test agent',
  url: 'http://agent.example.com',
  version: '1.0.0',
  capabilities: { streaming: false },
  skills: [{ id: 'skill-1', name: 'Skill One', description: 'Does something' }],
  ...overrides,
});

const agentUrl = 'http://agent.example.com';

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number): Response {
  return new Response('error', { status });
}

// ---------------------------------------------------------------------------
// Reset state between tests via remove()
// ---------------------------------------------------------------------------
beforeEach(() => {
  workerRegistry.remove(agentUrl);
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// discover()
// ---------------------------------------------------------------------------
describe('WorkerRegistry.discover()', () => {
  test('should fetch agent card from /.well-known/agent.json', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));

    const result = await workerRegistry.discover(agentUrl);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(calledUrl).toBe(`${agentUrl}/.well-known/agent.json`);
    expect(result.name).toBe(card.name);
    expect(result.skills).toHaveLength(1);
  });

  test('should register the agent after successful discovery', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));

    await workerRegistry.discover(agentUrl);

    const agents = workerRegistry.list();
    expect(agents.some((a) => a.url === agentUrl)).toBe(true);
  });

  test('should send Authorization header when apiKey is provided', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));

    await workerRegistry.discover(agentUrl, 'my-secret');

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret');
  });

  test('should not send Authorization header when no apiKey', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));

    await workerRegistry.discover(agentUrl);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)?.['Authorization']).toBeUndefined();
  });

  test('should throw when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

    await expect(workerRegistry.discover(agentUrl)).rejects.toThrow('Failed to discover agent');
  });

  test('should include status code in error message when discovery fails', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

    await expect(workerRegistry.discover(agentUrl)).rejects.toThrow('404');
  });

  test('should throw when fetch rejects (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(workerRegistry.discover(agentUrl)).rejects.toThrow('Network error');
  });
});

// ---------------------------------------------------------------------------
// delegate()
// ---------------------------------------------------------------------------
describe('WorkerRegistry.delegate()', () => {
  test('should POST a JSON-RPC tasks/send request to the agent URL', async () => {
    const rpcResponse = { jsonrpc: '2.0', id: 'x', result: { done: true } };
    mockFetch.mockResolvedValueOnce(makeOkResponse(rpcResponse));

    const result = await workerRegistry.delegate(agentUrl, { skillId: 'skill-1', args: { k: 'v' } });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(agentUrl);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('tasks/send');
    expect(body.params).toEqual({ skillId: 'skill-1', args: { k: 'v' } });
    expect(result).toEqual({ done: true });
  });

  test('should include Authorization header when agent was registered with apiKey', async () => {
    // First discover the agent so its apiKey is stored
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));
    await workerRegistry.discover(agentUrl, 'secret-key');

    const rpcResponse = { jsonrpc: '2.0', id: 'y', result: null };
    mockFetch.mockResolvedValueOnce(makeOkResponse(rpcResponse));
    await workerRegistry.delegate(agentUrl, { skillId: 'skill-1' });

    const [, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-key');
  });

  test('should throw when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

    await expect(
      workerRegistry.delegate(agentUrl, { skillId: 'skill-1' })
    ).rejects.toThrow('Delegation failed');
  });

  test('should throw when JSON-RPC response contains an error', async () => {
    const rpcErrorResponse = {
      jsonrpc: '2.0',
      id: 'z',
      error: { code: -32000, message: 'agent exploded' },
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(rpcErrorResponse));

    await expect(
      workerRegistry.delegate(agentUrl, { skillId: 'skill-1' })
    ).rejects.toThrow('agent exploded');
  });

  test('should throw when fetch rejects (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(
      workerRegistry.delegate(agentUrl, { skillId: 'skill-1' })
    ).rejects.toThrow('Connection refused');
  });
});

// ---------------------------------------------------------------------------
// list() / remove()
// ---------------------------------------------------------------------------
describe('WorkerRegistry.list() and remove()', () => {
  test('should list registered agents', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));
    await workerRegistry.discover(agentUrl);

    const agents = workerRegistry.list();
    expect(agents.some((a) => a.url === agentUrl)).toBe(true);
  });

  test('should remove an agent by URL', async () => {
    const card = makeAgentCard();
    mockFetch.mockResolvedValueOnce(makeOkResponse(card));
    await workerRegistry.discover(agentUrl);

    workerRegistry.remove(agentUrl);
    expect(workerRegistry.list().some((a) => a.url === agentUrl)).toBe(false);
  });
});
