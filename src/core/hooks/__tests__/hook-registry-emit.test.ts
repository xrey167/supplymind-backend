import { describe, it, expect, beforeEach } from 'bun:test';
import { LifecycleHookRegistry } from '../hook-registry';

describe('LifecycleHookRegistry on/off/emit', () => {
  let registry: LifecycleHookRegistry;

  beforeEach(() => {
    registry = new LifecycleHookRegistry();
  });

  it('registers and fires a hook', async () => {
    let fired = false;
    registry.on('task_created', async (_payload) => { fired = true; });
    await registry.emit('task_created', { taskId: 'task_1', workspaceId: 'ws_1' });
    expect(fired).toBe(true);
  });

  it('supports multiple handlers for the same event', async () => {
    let count = 0;
    registry.on('agent_start', async () => { count++; });
    registry.on('agent_start', async () => { count++; });
    await registry.emit('agent_start', { agentId: 'a_1', workspaceId: 'ws_1' });
    expect(count).toBe(2);
  });

  it('fires pre_compact hook with message count', async () => {
    let messageCount = 0;
    registry.on('pre_compact', async (payload) => { messageCount = payload.messageCount; });
    await registry.emit('pre_compact', { sessionId: 'sess_1', messageCount: 42, workspaceId: 'ws_1' });
    expect(messageCount).toBe(42);
  });

  it('fires permission_denied hook', async () => {
    let captured: string | undefined;
    registry.on('permission_denied', async (payload) => { captured = payload.reason; });
    await registry.emit('permission_denied', { userId: 'u_1', workspaceId: 'ws_1', reason: 'RBAC: missing admin role' });
    expect(captured).toBe('RBAC: missing admin role');
  });

  it('fires domain_registered hook', async () => {
    let name: string | undefined;
    registry.on('domain_registered', async (payload) => { name = payload.domainName; });
    await registry.emit('domain_registered', { domainName: 'inventory', workspaceId: 'ws_1' });
    expect(name).toBe('inventory');
  });

  it('off() removes a handler', async () => {
    let count = 0;
    const handler = async () => { count++; };
    registry.on('session_start', handler);
    registry.off('session_start', handler);
    await registry.emit('session_start', { sessionId: 'sess_1', workspaceId: 'ws_1' });
    expect(count).toBe(0);
  });

  it('handlers run concurrently', async () => {
    const order: number[] = [];
    registry.on('session_end', async () => { await new Promise(r => setTimeout(r, 10)); order.push(1); });
    registry.on('session_end', async () => { order.push(2); });
    await registry.emit('session_end', { sessionId: 'sess_1', workspaceId: 'ws_1' });
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it('fires post_compact hook with removedCount', async () => {
    let removed = 0;
    registry.on('post_compact', async (payload) => { removed = payload.removedCount; });
    await registry.emit('post_compact', { sessionId: 's1', removedCount: 15, workspaceId: 'ws_1' });
    expect(removed).toBe(15);
  });

  it('fires subagent_start hook', async () => {
    let sub: string | undefined;
    registry.on('subagent_start', async (payload) => { sub = payload.subagentId; });
    await registry.emit('subagent_start', { parentAgentId: 'p1', subagentId: 'sa1', workspaceId: 'ws_1' });
    expect(sub).toBe('sa1');
  });

  it('fires memory_extracted hook with factCount', async () => {
    let facts = 0;
    registry.on('memory_extracted', async (payload) => { facts = payload.factCount; });
    await registry.emit('memory_extracted', { sessionId: 's1', workspaceId: 'ws_1', scope: 'workspace', factCount: 3 });
    expect(facts).toBe(3);
  });

  it('fires workflow_gate hook', async () => {
    let gate: string | undefined;
    registry.on('workflow_gate', async (payload) => { gate = payload.gateId; });
    await registry.emit('workflow_gate', { orchestrationId: 'o1', gateId: 'g1', workspaceId: 'ws_1' });
    expect(gate).toBe('g1');
  });

  it('fires tool_discovery hook', async () => {
    let deferred: boolean | undefined;
    registry.on('tool_discovery', async (payload) => { deferred = payload.deferred; });
    await registry.emit('tool_discovery', { toolName: 'search', workspaceId: 'ws_1', deferred: true });
    expect(deferred).toBe(true);
  });
});
