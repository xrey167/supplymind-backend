import type { DomainEvent, DomainEventStrategy, StrategyContext, SupplierRiskPayload, SupplierLeadTimePayload } from '../types';

// TODO: Make thresholds configurable per workspace (load from DB or config)
const RISK_SPIKE_THRESHOLD = 80;
const RISK_CHANGE_THRESHOLD = 20;
const LEAD_TIME_CHANGE_PERCENT = 25;

export interface SupplierData {
  supplierId: string;
  riskScore: number;
  previousRiskScore: number;
  // TODO: Add quality metrics (defect rate, inspection pass rate)
  // TODO: Add capacity data (utilization %, max capacity, availability windows)
  // TODO: Add compliance data (certifications, audit results, expiry dates)
  leadTimes?: Array<{
    materialId: string;
    currentDays: number;
    previousDays: number;
  }>;
}

export const supplierStrategy: DomainEventStrategy<SupplierData> = {
  entityType: 'supplier',

  evaluate(data: SupplierData, context: StrategyContext): DomainEvent[] {
    const events: DomainEvent[] = [];

    // TODO: Implement risk spike detection
    // - Check if riskScore >= RISK_SPIKE_THRESHOLD
    // - Check if riskScore increased by >= RISK_CHANGE_THRESHOLD from previous
    // - Emit 'domain:supplier:risk_spike' with SupplierRiskPayload
    // - Severity: critical if >= 90, warning if >= 80

    // TODO: Implement risk resolved detection
    // - Check if previousRiskScore >= RISK_SPIKE_THRESHOLD && riskScore < RISK_SPIKE_THRESHOLD
    // - Emit 'domain:supplier:risk_resolved'

    // TODO: Implement lead time change detection
    // - For each lead time entry, check if change > LEAD_TIME_CHANGE_PERCENT
    // - Emit 'domain:supplier:lead_time_change' with SupplierLeadTimePayload

    // TODO: Implement quality alert detection
    // - Check defect rate against threshold
    // - Check inspection failure trends
    // - Emit 'domain:supplier:quality_alert'

    // TODO: Implement capacity change detection
    // - Check utilization spikes or drops
    // - Emit 'domain:supplier:capacity_change'

    return events;
  },
};
