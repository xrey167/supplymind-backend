export type AlertConditionOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists';

export interface AlertCondition {
  field: string;
  operator: AlertConditionOperator;
  value?: unknown;
}

export interface AlertRule {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  eventTopic: string;
  conditions: AlertCondition[];
  notifyUserIds: string[];
  messageTemplate: string | null;
  cooldownSeconds: number;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRuleFire {
  id: string;
  ruleId: string;
  workspaceId: string;
  eventTopic: string;
  eventData: Record<string, unknown> | null;
  firedAt: Date;
}

export interface CreateAlertRuleInput {
  workspaceId: string;
  name: string;
  description?: string;
  eventTopic: string;
  conditions?: AlertCondition[];
  notifyUserIds?: string[];
  messageTemplate?: string;
  cooldownSeconds?: number;
  createdBy: string;
}

export interface UpdateAlertRuleInput {
  name?: string;
  description?: string;
  eventTopic?: string;
  conditions?: AlertCondition[];
  notifyUserIds?: string[];
  messageTemplate?: string;
  cooldownSeconds?: number;
  enabled?: boolean;
}
