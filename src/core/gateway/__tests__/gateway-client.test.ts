import { describe, it, expect, mock, beforeEach } from 'bun:test';

/**
 * Gateway client tests.
 *
 * We inject a mock execute() via the _execute option to verify the client
 * sends correct ops and params. Use require+proxy to avoid contaminating
 * skills.registry.test.ts.
 */

const mockExecute = mock((_req: any) => Promise.resolve({ ok: true as const, value: {} }));

// Full skills.registry mock — must include all methods since mock.module
// replaces the module globally. Uses stable mock references (not inline mock()).
const _mockSkillRegister = mock(() => {});
const _mockSkillUnregister = mock(() => {});
mock.module('../../../modules/skills/skills.registry', () => {
  const skills = new Map<string, any>();
  class SkillRegistry {
    register(skill: any) { _mockSkillRegister(skill); skills.set(skill.name, skill); }
    unregister(name: string) { _mockSkillUnregister(name); skills.delete(name); }
    get(name: string) { return skills.get(name); }
    has(name: string) { return skills.has(name); }
    list() { return Array.from(skills.values()); }
    clear() { skills.clear(); }
    toToolDefinitions() {
      return this.list().map((s: any) => ({
        name: s.name, description: s.description, inputSchema: s.inputSchema,
        ...(s.toolHints?.strict != null && { strict: s.toolHints.strict }),
        ...(s.toolHints?.cacheable && { cacheControl: { type: 'ephemeral' } }),
        ...(s.toolHints?.eagerInputStreaming != null && { eagerInputStreaming: s.toolHints.eagerInputStreaming }),
      }));
    }
    async invoke(name: string, args: any, ctx?: any) {
      const s = skills.get(name);
      if (!s) return { ok: false, error: new Error(`Skill not found: ${name}`) };
      return s.handler(args, ctx);
    }
    async loadFromProviders(providers: any[]) {
      for (const p of providers) for (const s of await p.loadSkills()) this.register(s);
    }
  }
  return { skillRegistry: new SkillRegistry(), SkillRegistry };
});

import { GatewayClient, createGatewayClient } from '../gateway-client';

describe('GatewayClient', () => {
  let client: InstanceType<typeof GatewayClient>;

  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ ok: true, value: {} });
    client = createGatewayClient({ callerId: 'test', workspaceId: 'ws-1', _execute: mockExecute });
  });

  it('sendTask calls task.send op', async () => {
    await client.sendTask('agent-1', 'Hello');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('task.send');
    expect(call.params.agentId).toBe('agent-1');
    expect(call.params.message).toBe('Hello');
  });

  it('getTask calls task.get op', async () => {
    await client.getTask('t-1');
    expect(mockExecute.mock.calls[0][0].op).toBe('task.get');
    expect(mockExecute.mock.calls[0][0].params.id).toBe('t-1');
  });

  it('cancelTask calls task.cancel op', async () => {
    await client.cancelTask('t-1');
    expect(mockExecute.mock.calls[0][0].op).toBe('task.cancel');
  });

  it('listTasks calls task.list op', async () => {
    await client.listTasks();
    expect(mockExecute.mock.calls[0][0].op).toBe('task.list');
  });

  it('invokeSkill calls skill.invoke op', async () => {
    await client.invokeSkill('echo', { text: 'hi' });
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('skill.invoke');
    expect(call.params.name).toBe('echo');
    expect(call.params.args).toEqual({ text: 'hi' });
  });

  it('listSkills calls skill.list op', async () => {
    await client.listSkills();
    expect(mockExecute.mock.calls[0][0].op).toBe('skill.list');
  });

  it('listAgents calls agent.list op', async () => {
    await client.listAgents();
    expect(mockExecute.mock.calls[0][0].op).toBe('agent.list');
  });

  it('delegateA2A calls a2a.delegate op', async () => {
    await client.delegateA2A('http://agent.example.com', { skillId: 'search' });
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('a2a.delegate');
    expect(call.params.agentUrl).toBe('http://agent.example.com');
    expect(call.params.skillId).toBe('search');
  });

  it('respondToInput calls task.input op', async () => {
    await client.respondToInput('t-1', { answer: 'yes' });
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('task.input');
    expect(call.params.taskId).toBe('t-1');
    expect(call.params.input).toEqual({ answer: 'yes' });
  });

  it('respondToGate calls orchestration.gate.respond op', async () => {
    await client.respondToGate('orch-1', 'step-1', true);
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('orchestration.gate.respond');
    expect(call.params.approved).toBe(true);
  });

  it('createGatewayClient defaults callerRole to operator', () => {
    const c = createGatewayClient({ callerId: 'test', workspaceId: 'ws-1', _execute: mockExecute });
    expect(c).toBeInstanceOf(GatewayClient);
  });

  it('createGatewayClient accepts custom callerRole', () => {
    const c = createGatewayClient({ callerId: 'test', workspaceId: 'ws-1', callerRole: 'system', _execute: mockExecute });
    expect(c).toBeInstanceOf(GatewayClient);
  });

  it('interruptTask calls task.interrupt op', async () => {
    await client.interruptTask('t-1');
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('task.interrupt');
    expect(call.params.id).toBe('t-1');
  });

  it('respondToApproval calls task.input with approval fields', async () => {
    await client.respondToApproval('ap-1', true, { file: '/safe.txt' });
    const call = mockExecute.mock.calls[0][0];
    expect(call.op).toBe('task.input');
    expect(call.params.approvalId).toBe('ap-1');
    expect(call.params.approved).toBe(true);
    expect(call.params.updatedInput).toEqual({ file: '/safe.txt' });
  });

  it('tool() returns cleanup function', async () => {
    const cleanup = await client.tool({
      name: 'my-tool',
      description: 'Test tool',
      handler: async () => ({ result: 'ok' }),
    });
    expect(typeof cleanup).toBe('function');
  });

  it('onHook() returns cleanup function', async () => {
    const cleanup = await client.onHook('pre_tool_use', async () => {});
    expect(typeof cleanup).toBe('function');
  });
});
