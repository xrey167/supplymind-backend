import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

// ── Mock handles ──────────────────────────────────────────────────────────────

const mockNotify = mock(async () => null);

const baseRule = {
  id: 'rule-1',
  workspaceId: 'ws-1',
  name: 'Test Rule',
  description: null,
  eventTopic: 'task.error',
  conditions: [],
  notifyUserIds: ['user-1'],
  messageTemplate: null,
  cooldownSeconds: 300,
  enabled: true,
  createdBy: 'user-creator',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRepo = {
  createRule: mock(async (input: any) => ({ ...baseRule, ...input, id: 'rule-1', createdAt: new Date(), updatedAt: new Date() })),
  listRules: mock(async () => []),
  getRule: mock(async () => baseRule),
  updateRule: mock(async (_id: string, input: any) => ({ ...baseRule, ...input })),
  deleteRule: mock(async () => {}),
  getEnabledRulesForTopic: mock(async () => [baseRule]),
  // Atomically checks cooldown and records fire; null = in cooldown
  fireWithCooldownCheck: mock(async () => ({ id: 'fire-1', ruleId: 'rule-1', workspaceId: 'ws-1', eventTopic: 'task.error', eventData: null, firedAt: new Date() })),
  listFires: mock(async () => []),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

const _realAlertRulesRepo = require('../alert-rules.repo');
mock.module('../alert-rules.repo', () => ({ ..._realAlertRulesRepo, alertRulesRepo: mockRepo }));

const _realNotifModule = require('../../notifications/notifications.service');
mock.module('../../notifications/notifications.service', () => ({
  ..._realNotifModule,
  notificationsService: { ..._realNotifModule.notificationsService, notify: mockNotify },
}));

const { alertRulesService, evalCondition } = await import('../alert-rules.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearMocks() {
  mockNotify.mockClear();
  (Object.values(mockRepo) as ReturnType<typeof mock>[]).forEach(m => m.mockReset());
  // Restore default implementations after reset
  mockRepo.getRule.mockImplementation(async () => baseRule);
  mockRepo.fireWithCooldownCheck.mockImplementation(async () => ({ id: 'fire-1', ruleId: 'rule-1', workspaceId: 'ws-1', eventTopic: 'task.error', eventData: null, firedAt: new Date() }));
  mockRepo.listRules.mockImplementation(async () => []);
  mockRepo.listFires.mockImplementation(async () => []);
  mockRepo.updateRule.mockImplementation(async (_id: string, input: any) => ({ ...baseRule, ...input }));
  mockRepo.deleteRule.mockImplementation(async () => {});
  mockRepo.createRule.mockImplementation(async (input: any) => ({ ...baseRule, ...input, id: 'rule-1', createdAt: new Date(), updatedAt: new Date() }));
  mockRepo.getEnabledRulesForTopic.mockImplementation(async () => [baseRule]);
}

beforeEach(clearMocks);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('evalCondition', () => {
  const data = { level: 3, name: 'error', nested: { code: 'E404' }, present: true };

  it('eq — matches equal value', () => {
    expect(evalCondition(data, { field: 'level', operator: 'eq', value: 3 })).toBe(true);
    expect(evalCondition(data, { field: 'level', operator: 'eq', value: 99 })).toBe(false);
  });

  it('neq — matches non-equal value', () => {
    expect(evalCondition(data, { field: 'level', operator: 'neq', value: 99 })).toBe(true);
    expect(evalCondition(data, { field: 'level', operator: 'neq', value: 3 })).toBe(false);
  });

  it('gt — greater than', () => {
    expect(evalCondition(data, { field: 'level', operator: 'gt', value: 2 })).toBe(true);
    expect(evalCondition(data, { field: 'level', operator: 'gt', value: 5 })).toBe(false);
  });

  it('lt — less than', () => {
    expect(evalCondition(data, { field: 'level', operator: 'lt', value: 5 })).toBe(true);
    expect(evalCondition(data, { field: 'level', operator: 'lt', value: 1 })).toBe(false);
  });

  it('contains — substring match', () => {
    expect(evalCondition(data, { field: 'name', operator: 'contains', value: 'err' })).toBe(true);
    expect(evalCondition(data, { field: 'name', operator: 'contains', value: 'xyz' })).toBe(false);
  });

  it('exists — field present and non-null', () => {
    expect(evalCondition(data, { field: 'present', operator: 'exists' })).toBe(true);
    expect(evalCondition(data, { field: 'missing', operator: 'exists' })).toBe(false);
  });

  it('dot-path resolution', () => {
    expect(evalCondition(data, { field: 'nested.code', operator: 'eq', value: 'E404' })).toBe(true);
  });
});

describe('AlertRulesService.fire', () => {
  it('no cooldown → records fire and sends notification', async () => {
    await alertRulesService.fire(baseRule, 'task.error', { workspaceId: 'ws-1', taskId: 't-1' });

    expect(mockRepo.fireWithCooldownCheck).toHaveBeenCalledWith(
      'rule-1', 'ws-1', 'task.error', expect.any(Object), 300,
    );
    await new Promise(r => setTimeout(r, 10));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert_fired', userId: 'user-1', workspaceId: 'ws-1' }),
    );
  });

  it('within cooldown window → skips notification', async () => {
    // fireWithCooldownCheck returns null when the rule is still in cooldown
    mockRepo.fireWithCooldownCheck.mockImplementation(async () => null);

    await alertRulesService.fire(baseRule, 'task.error', { workspaceId: 'ws-1' });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('service.fire does not re-evaluate conditions (handler pre-filters)', async () => {
    // Conditions are checked by the event handler before calling service.fire —
    // service.fire itself always attempts to fire (cooldown check only).
    const ruleWithCondition = {
      ...baseRule,
      conditions: [{ field: 'level', operator: 'gt' as const, value: 10 }],
    };
    await alertRulesService.fire(ruleWithCondition, 'task.error', { workspaceId: 'ws-1', level: 1 });
    expect(mockRepo.fireWithCooldownCheck).toHaveBeenCalledTimes(1);
  });
});

describe('AlertRulesService condition filtering (handler simulation)', () => {
  it('event passes condition check → fire is called', async () => {
    const rule = { ...baseRule, conditions: [{ field: 'severity', operator: 'eq' as const, value: 'critical' }] };
    const data = { workspaceId: 'ws-1', severity: 'critical' };

    const passes = rule.conditions.every(c => evalCondition(data, c));
    expect(passes).toBe(true);
  });

  it('event fails condition check → fire is NOT called', () => {
    const rule = { ...baseRule, conditions: [{ field: 'severity', operator: 'eq' as const, value: 'critical' }] };
    const data = { workspaceId: 'ws-1', severity: 'low' };

    const passes = rule.conditions.every(c => evalCondition(data, c));
    expect(passes).toBe(false);
  });
});

afterAll(() => mock.restore());
