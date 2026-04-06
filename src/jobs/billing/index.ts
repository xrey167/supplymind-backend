import { billingRepo } from '../../modules/billing/billing.repo';
import { logger } from '../../config/logger';

/**
 * Daily job: check for past-due subscriptions and downgrade to free.
 * Should be called by a cron scheduler.
 */
export async function checkPastDueSubscriptions(): Promise<number> {
  const pastDue = await billingRepo.getPastDueSubscriptions();
  let downgraded = 0;

  for (const sub of pastDue) {
    // If past_due for more than 7 days past period end, downgrade
    const gracePeriodEnd = new Date(sub.currentPeriodEnd!.getTime() + 7 * 86_400_000);
    if (new Date() > gracePeriodEnd) {
      await billingRepo.upsertSubscription({
        workspaceId: sub.workspaceId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        stripePriceId: sub.stripePriceId,
        plan: 'free',
        status: 'canceled',
        currentPeriodStart: sub.currentPeriodStart!,
        currentPeriodEnd: sub.currentPeriodEnd!,
        cancelAtPeriodEnd: true,
      });
      downgraded++;
      logger.info({ workspaceId: sub.workspaceId, subscriptionId: sub.id }, 'Downgraded past-due subscription to free');
    }
  }

  if (downgraded > 0) {
    logger.info({ downgraded, total: pastDue.length }, 'Past-due subscription check complete');
  }
  return downgraded;
}
