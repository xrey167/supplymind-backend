import * as Sentry from '@sentry/node';
import { logger } from '../../config/logger';

let initialized = false;

export function initSentry(): void {
  const dsn = Bun.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry DSN not configured — skipping initialization');
    return;
  }

  if (initialized) return;

  Sentry.init({
    dsn,
    environment: Bun.env.NODE_ENV ?? 'development',
    tracesSampleRate: Bun.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    profilesSampleRate: Bun.env.NODE_ENV === 'production' ? 0.1 : 0,
  });

  initialized = true;
  logger.info('Sentry initialized');
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
}

export function setUser(id: string, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.setUser({ id, ...extra });
}

export { Sentry };
