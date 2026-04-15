import { describe, test, expect, mock, afterAll, beforeEach, afterEach } from 'bun:test';
import { EventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';

const mockLog = mock();

mock.module('../../../modules/audit-logs/audit-logs.service', () => ({
  auditLogsService: { log: mockLog },
  AuditLogsService: class {},
}));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: new Proxy(_realLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (prop === 'error') return mock();
      if (prop === 'info') return mock();
      if (prop === 'debug') return mock();
      if (prop === 'warn') return mock();
      return target[prop];
    },
  }),
}));

// We need a fresh event bus for testing so handlers don't leak
let testBus: EventBus;

// Re-mock the bus module to use our test bus
const _realBus = require('../../../events/bus');
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: (() => {
    testBus = new EventBus();
    return testBus;
  })(),
}));

const { initAuditLogHandler } = await import('../../../events/consumers/audit-log.handler');

describe('Audit Log Event Handler', () => {
  beforeEach(() => {
    mockLog.mockClear();
    testBus.reset();
    initAuditLogHandler();
  });

  test('agent.created event creates an audit log', async () => {
    await testBus.publish(Topics.AGENT_CREATED, {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      userId: 'user-1',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'create',
      resourceType: 'agent',
      resourceId: 'agent-1',
      actorId: 'user-1',
    });
  });

  test('agent.updated event creates an audit log', async () => {
    await testBus.publish(Topics.AGENT_UPDATED, {
      workspaceId: 'ws-1',
      agentId: 'agent-2',
      userId: 'user-1',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'update',
      resourceType: 'agent',
    });
  });

  test('agent.deleted event creates an audit log', async () => {
    await testBus.publish(Topics.AGENT_DELETED, {
      workspaceId: 'ws-1',
      agentId: 'agent-3',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'delete',
      resourceType: 'agent',
      actorId: 'system',
      actorType: 'system',
    });
  });

  test('credentials.created event creates an audit log', async () => {
    await testBus.publish(Topics.CREDENTIAL_CREATED, {
      workspaceId: 'ws-1',
      credentialId: 'cred-1',
      userId: 'user-1',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'create',
      resourceType: 'credential',
      resourceId: 'cred-1',
    });
  });

  test('credentials.deleted event creates an audit log', async () => {
    await testBus.publish(Topics.CREDENTIAL_DELETED, {
      workspaceId: 'ws-1',
      credentialId: 'cred-2',
      userId: 'user-1',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'delete',
      resourceType: 'credential',
    });
  });

  test('billing.subscription_created event creates an audit log', async () => {
    await testBus.publish(Topics.SUBSCRIPTION_CREATED, {
      workspaceId: 'ws-1',
      subscriptionId: 'sub-1',
      plan: 'pro',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'plan_change',
      resourceType: 'subscription',
      actorType: 'system',
    });
  });

  test('member.joined event creates an audit log', async () => {
    await testBus.publish(Topics.MEMBER_JOINED, {
      workspaceId: 'ws-1',
      userId: 'user-2',
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({
      action: 'create',
      resourceType: 'member',
      actorId: 'user-2',
    });
  });
});

afterAll(() => mock.restore());
