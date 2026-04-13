import { eventBus } from '../bus';
import { alertRulesRepo } from '../../modules/alert-rules/alert-rules.repo';
import { alertRulesService, evalCondition } from '../../modules/alert-rules/alert-rules.service';
import { logger } from '../../core/logger';

export function initAlertRulesHandler(): void {
  eventBus.subscribe('*', async (event) => {
    try {
      const rules = await alertRulesRepo.getEnabledRulesForTopic(event.topic);
      if (rules.length === 0) return;

      const data = (event.data ?? {}) as Record<string, unknown>;

      for (const rule of rules) {
        // Workspace isolation: only fire if the event carries a matching workspaceId
        if (data.workspaceId !== rule.workspaceId) continue;
        if (!rule.conditions.every(c => evalCondition(data, c))) continue;
        await alertRulesService.fire(rule, event.topic, data);
      }
    } catch (err) {
      logger.error({ err, eventId: event.id, topic: event.topic }, 'alert-rules handler failed');
    }
  }, { name: 'alert-rules.handler' });

  logger.info('Alert rules handler initialized');
}
