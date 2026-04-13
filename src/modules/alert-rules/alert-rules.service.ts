import { notificationsService } from '../notifications/notifications.service';
import { NotFoundError } from '../../core/errors';
import { alertRulesRepo } from './alert-rules.repo';
import type { AlertRule, AlertRuleFire, AlertCondition, CreateAlertRuleInput, UpdateAlertRuleInput } from './alert-rules.types';

// Resolve a dot-path into a nested object, e.g. 'error.code' on { error: { code: 404 } }
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((v: unknown, k) => (v != null && typeof v === 'object') ? (v as Record<string, unknown>)[k] : undefined, obj);
}

export function evalCondition(data: unknown, cond: AlertCondition): boolean {
  const val = getPath(data, cond.field);
  switch (cond.operator) {
    case 'eq':       return val === cond.value;
    case 'neq':      return val !== cond.value;
    case 'gt':       return Number(val) > Number(cond.value);
    case 'lt':       return Number(val) < Number(cond.value);
    case 'contains': return typeof val === 'string' && val.includes(String(cond.value));
    case 'exists':   return val !== undefined && val !== null;
    default:         return false;
  }
}

function applyTemplate(template: string | null, data: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const val = getPath(data, path);
    return val != null ? String(val) : '';
  });
}

class AlertRulesService {
  async createRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    return alertRulesRepo.createRule({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      eventTopic: input.eventTopic,
      conditions: input.conditions ?? [],
      notifyUserIds: input.notifyUserIds ?? [],
      messageTemplate: input.messageTemplate,
      cooldownSeconds: input.cooldownSeconds ?? 300,
      createdBy: input.createdBy,
    });
  }

  async listRules(workspaceId: string): Promise<AlertRule[]> {
    return alertRulesRepo.listRules(workspaceId);
  }

  async getRule(id: string): Promise<AlertRule> {
    const rule = await alertRulesRepo.getRule(id);
    if (!rule) throw new NotFoundError(`Alert rule ${id} not found`);
    return rule;
  }

  async updateRule(id: string, workspaceId: string, input: UpdateAlertRuleInput): Promise<AlertRule> {
    const existing = await alertRulesRepo.getRule(id);
    if (!existing || existing.workspaceId !== workspaceId) throw new NotFoundError(`Alert rule ${id} not found`);
    const updated = await alertRulesRepo.updateRule(id, input);
    return updated!;
  }

  async deleteRule(id: string, workspaceId: string): Promise<void> {
    await alertRulesRepo.deleteRule(id, workspaceId);
  }

  async toggleRule(id: string, workspaceId: string): Promise<AlertRule> {
    const rule = await alertRulesRepo.getRule(id);
    if (!rule || rule.workspaceId !== workspaceId) throw new NotFoundError(`Alert rule ${id} not found`);
    const updated = await alertRulesRepo.updateRule(id, { enabled: !rule.enabled });
    return updated!;
  }

  async listFires(ruleId: string, workspaceId: string): Promise<AlertRuleFire[]> {
    const rule = await alertRulesRepo.getRule(ruleId);
    if (!rule || rule.workspaceId !== workspaceId) throw new NotFoundError(`Alert rule ${ruleId} not found`);
    return alertRulesRepo.listFires(ruleId);
  }

  // Called by the event consumer for each matching rule
  async fire(rule: AlertRule, eventTopic: string, data: Record<string, unknown>): Promise<void> {
    const lastFire = await alertRulesRepo.getLastFireInCooldown(rule.id, rule.cooldownSeconds);
    if (lastFire) return; // still in cooldown

    await alertRulesRepo.recordFire(rule.id, rule.workspaceId, eventTopic, data);

    const body = applyTemplate(rule.messageTemplate, data);

    for (const userId of rule.notifyUserIds) {
      notificationsService.notify({
        workspaceId: rule.workspaceId,
        userId,
        type: 'alert_fired',
        title: rule.name,
        body,
        metadata: { ruleId: rule.id, eventTopic },
      }).catch(() => {});
    }
  }
}

export const alertRulesService = new AlertRulesService();
