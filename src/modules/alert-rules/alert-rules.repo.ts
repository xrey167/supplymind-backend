import { eq, and, desc, gte, or, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { alertRules, alertRuleFires } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { AlertRule, AlertRuleFire, AlertCondition, UpdateAlertRuleInput } from './alert-rules.types';

type RuleRow = typeof alertRules.$inferSelect;
type NewRuleRow = typeof alertRules.$inferInsert;

function toRule(row: RuleRow): AlertRule {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    eventTopic: row.eventTopic,
    conditions: (row.conditions ?? []) as AlertCondition[],
    notifyUserIds: (row.notifyUserIds ?? []) as string[],
    messageTemplate: row.messageTemplate,
    cooldownSeconds: row.cooldownSeconds,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFire(row: typeof alertRuleFires.$inferSelect): AlertRuleFire {
  return {
    id: row.id,
    ruleId: row.ruleId,
    workspaceId: row.workspaceId,
    eventTopic: row.eventTopic,
    eventData: row.eventData as Record<string, unknown> | null,
    firedAt: row.firedAt,
  };
}

class AlertRulesRepository extends BaseRepo<typeof alertRules, RuleRow, NewRuleRow> {
  constructor() { super(alertRules); }

  async createRule(input: {
    workspaceId: string;
    name: string;
    description?: string;
    eventTopic: string;
    conditions: AlertCondition[];
    notifyUserIds: string[];
    messageTemplate?: string;
    cooldownSeconds: number;
    createdBy: string;
  }): Promise<AlertRule> {
    const rows = await db.insert(alertRules).values({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      eventTopic: input.eventTopic,
      conditions: input.conditions,
      notifyUserIds: input.notifyUserIds,
      messageTemplate: input.messageTemplate ?? null,
      cooldownSeconds: input.cooldownSeconds,
      createdBy: input.createdBy,
    }).returning();
    return toRule(rows[0]!);
  }

  async listRules(workspaceId: string): Promise<AlertRule[]> {
    const rows = await db.select().from(alertRules)
      .where(eq(alertRules.workspaceId, workspaceId))
      .orderBy(desc(alertRules.createdAt));
    return rows.map(toRule);
  }

  async getRule(id: string): Promise<AlertRule | null> {
    const rows = await db.select().from(alertRules)
      .where(eq(alertRules.id, id)).limit(1);
    return rows[0] ? toRule(rows[0]) : null;
  }

  async updateRule(id: string, input: UpdateAlertRuleInput): Promise<AlertRule | null> {
    const rows = await db.update(alertRules)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(alertRules.id, id))
      .returning();
    return rows[0] ? toRule(rows[0]) : null;
  }

  async deleteRule(id: string, workspaceId: string): Promise<void> {
    await db.delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.workspaceId, workspaceId)));
  }

  // Returns rules whose eventTopic exactly matches the incoming topic, or whose
  // eventTopic is a prefix of the incoming topic (e.g. stored 'task.' matches incoming 'task.error')
  async getEnabledRulesForTopic(topic: string): Promise<AlertRule[]> {
    const rows = await db.select().from(alertRules)
      .where(and(
        eq(alertRules.enabled, true),
        or(
          eq(alertRules.eventTopic, topic),
          sql`${topic} LIKE ${alertRules.eventTopic} || '%'`,
        ),
      ));
    return rows.map(toRule);
  }

  // Atomically checks cooldown and records a fire under a row-level lock.
  // Returns the new fire record, or null if the rule is still within its cooldown window.
  // Using SELECT FOR UPDATE prevents concurrent workers from both passing the cooldown check.
  async fireWithCooldownCheck(
    ruleId: string,
    workspaceId: string,
    eventTopic: string,
    eventData: Record<string, unknown>,
    cooldownSeconds: number,
  ): Promise<AlertRuleFire | null> {
    return db.transaction(async (tx) => {
      // Lock the rule row — concurrent callers for the same rule will queue here
      await tx.execute(sql`SELECT id FROM alert_rules WHERE id = ${ruleId} FOR UPDATE`);

      const cutoff = new Date(Date.now() - cooldownSeconds * 1000);
      const recent = await tx.select().from(alertRuleFires)
        .where(and(eq(alertRuleFires.ruleId, ruleId), gte(alertRuleFires.firedAt, cutoff)))
        .limit(1);

      if (recent.length > 0) return null; // still in cooldown

      const rows = await tx.insert(alertRuleFires).values({
        ruleId, workspaceId, eventTopic, eventData,
      }).returning();
      return toFire(rows[0]!);
    });
  }

  async listFires(ruleId: string, limit = 50): Promise<AlertRuleFire[]> {
    const rows = await db.select().from(alertRuleFires)
      .where(eq(alertRuleFires.ruleId, ruleId))
      .orderBy(desc(alertRuleFires.firedAt))
      .limit(limit);
    return rows.map(toFire);
  }
}

export const alertRulesRepo = new AlertRulesRepository();
