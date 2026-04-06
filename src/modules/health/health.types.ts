export type CheckStatus = 'ok' | 'error';

export interface ReadinessResult {
  status: 'ready' | 'degraded';
  checks: { db: CheckStatus; redis: CheckStatus };
}
