import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

// Mock logger before importing audit — stable mock references for assertions
const _realLogger = require('../../../config/logger');
const _auditMockInfo = mock(() => {});
const _auditMockError = mock(() => {});
const _auditMockWarn = mock(() => {});
const _auditMockDebug = mock(() => {});
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: new Proxy(_realLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (prop === 'info') return _auditMockInfo;
      if (prop === 'error') return _auditMockError;
      if (prop === 'warn') return _auditMockWarn;
      if (prop === 'debug') return _auditMockDebug;
      return target[prop];
    },
  }),
}));

// Use real EventBus — it's a pure in-memory class, no side effects
import { EventBus } from '../../../events/bus';

const testBus = new EventBus();

const _realBus = require('../../../events/bus');
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: testBus,
}));

const { audit } = await import('../audit');
const { logger } = await import('../../../config/logger');

describe('audit()', () => {
  beforeEach(() => {
    testBus.reset();
    (logger.info as ReturnType<typeof mock>).mockClear();
  });

  it('publishes to eventBus with topic audit.entry', async () => {
    const received: unknown[] = [];
    testBus.subscribe('audit.entry', (event) => {
      received.push(event.data);
    });

    audit({ action: 'user.login', actor: 'user-1', resource: 'session' });

    // give async delivery a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(received.length).toBe(1);
  });

  it('includes a timestamp on the published entry', async () => {
    const received: any[] = [];
    testBus.subscribe('audit.entry', (event) => {
      received.push(event.data);
    });

    const before = new Date();
    audit({ action: 'doc.create', actor: 'user-2', resource: 'document', resourceId: 'doc-42' });
    const after = new Date();

    await new Promise((r) => setTimeout(r, 0));

    const entry = received[0];
    expect(entry).toBeDefined();
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('passes through all provided fields', async () => {
    const received: any[] = [];
    testBus.subscribe('audit.entry', (event) => {
      received.push(event.data);
    });

    const input = {
      action: 'workspace.delete',
      actor: 'admin-1',
      resource: 'workspace',
      resourceId: 'ws-99',
      workspaceId: 'ws-99',
      metadata: { reason: 'test cleanup' },
    };

    audit(input);
    await new Promise((r) => setTimeout(r, 0));

    const entry = received[0];
    expect(entry.action).toBe(input.action);
    expect(entry.actor).toBe(input.actor);
    expect(entry.resource).toBe(input.resource);
    expect(entry.resourceId).toBe(input.resourceId);
    expect(entry.workspaceId).toBe(input.workspaceId);
    expect(entry.metadata).toEqual(input.metadata);
  });

  it('calls logger.info with the audit entry', async () => {
    audit({ action: 'api.call', actor: 'svc-1', resource: 'endpoint' });
    await new Promise((r) => setTimeout(r, 0));

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [obj, msg] = (logger.info as ReturnType<typeof mock>).mock.calls[0];
    expect(obj).toHaveProperty('audit');
    expect(msg).toContain('api.call');
  });

  it('works without optional fields', async () => {
    const received: any[] = [];
    testBus.subscribe('audit.entry', (event) => {
      received.push(event.data);
    });

    audit({ action: 'ping', actor: 'health-check', resource: 'system' });
    await new Promise((r) => setTimeout(r, 0));

    const entry = received[0];
    expect(entry.resourceId).toBeUndefined();
    expect(entry.workspaceId).toBeUndefined();
    expect(entry.metadata).toBeUndefined();
  });
});

afterAll(() => mock.restore());
